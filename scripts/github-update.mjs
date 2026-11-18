/** Build Preview from an approved framework commit and a validated private business package. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { readBusinessPackage, applyBusinessPackage } from './business-package.mjs';
import { readDeploymentConfig, readJson, writeJson } from './deployment-config.mjs';
import { packageRelease, verifyRelease } from './release.mjs';
import { deployRelease, checkHealth } from './deploy.mjs';

const execute = promisify(execFile);
const shaPattern = /^[a-f\d]{40}$/;
const repositoryPattern = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
const mainRef = 'refs/heads/main';

function privateGit(config) {
  const { repository, deployKey, knownHosts, projectId } = config;
  if (
    typeof repository !== 'string' ||
    !repositoryPattern.test(repository) ||
    ![deployKey, knownHosts].every((filename) => typeof filename === 'string' && /^\/[\w./-]+$/.test(filename)) ||
    typeof projectId !== 'string' ||
    !projectId
  )
    throw new Error('Invalid private business Git configuration');
  // Scope the repository credential to these Git calls and ignore machine-level SSH overrides.
  const options = {
    timeout: 120000,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_SSH_VARIANT: 'ssh',
      GIT_SSH_COMMAND: `ssh -F /dev/null -i ${deployKey} -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${knownHosts} -o GlobalKnownHostsFile=/dev/null`,
    },
  };
  const remote = `ssh://git@github.com/${repository}.git`;
  return {
    projectId,
    async head() {
      const { stdout } = await execute('git', ['ls-remote', '--exit-code', remote, mainRef], options);
      const [commit, ref] = stdout.trim().split('\t');
      if (!shaPattern.test(commit) || ref !== mainRef) throw new Error('Invalid private business main ref');
      return commit;
    },
    async checkoutPackage(workspace, commit) {
      const repository = path.join(workspace, 'business.git');
      await execute('git', ['init', '--quiet', '--bare', repository], options);
      await execute('git', ['fetch', '--quiet', '--depth=1', remote, mainRef], {
        ...options,
        cwd: repository,
      });
      const readGit = (args) => execute('git', args, { cwd: repository, timeout: options.timeout });
      if ((await readGit(['rev-parse', 'FETCH_HEAD'])).stdout.trim() !== commit)
        throw new Error('Private business main changed during fetch; defer to the next run');
      const object = `${commit}:project.json`;
      const { stdout: entry } = await readGit(['ls-tree', commit, '--', 'project.json']);
      if (!/^100644 blob [a-f\d]{40}\tproject\.json\r?\n$/.test(entry))
        throw new Error('Private business Git requires a regular project.json');
      const size = await readGit(['cat-file', '-s', object]);
      if (Number(size.stdout) > 192 * 1024 * 1024)
        throw new Error('Private business Git requires a project.json within the package size limit');
      const filename = path.join(workspace, 'project.json');
      const output = await fs.open(filename, 'wx', 0o600);
      try {
        await new Promise((resolve, reject) => {
          const child = spawn('git', ['cat-file', 'blob', object], {
            cwd: repository,
            stdio: ['ignore', output.fd, 'ignore'],
            timeout: options.timeout,
          });
          child.once('error', reject);
          child.once('close', (code) =>
            code === 0 ? resolve() : reject(new Error('Unable to read the private business package')),
          );
        });
      } finally {
        await output.close();
      }
      return filename;
    },
  };
}
async function removeBuildWorkspace(workspace, workRoot) {
  if (path.dirname(await fs.realpath(workspace)) !== (await fs.realpath(workRoot)))
    throw new Error('Updater cleanup escaped its workspace');
  await fs.rm(workspace, { recursive: true, force: true });
}
function validateWorkspace(config, deploy) {
  const relative = path.relative(deploy.storageRoot, path.resolve(config.workRoot));
  const maximumBuildMemoryMiB = config.maximumBuildMemoryMiB ?? 4096;
  if (
    !relative ||
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    !Number.isSafeInteger(maximumBuildMemoryMiB) ||
    maximumBuildMemoryMiB < 3072 ||
    maximumBuildMemoryMiB > 4096 ||
    !Number.isSafeInteger(config.minimumAvailableMemoryMiB) ||
    config.minimumAvailableMemoryMiB < maximumBuildMemoryMiB + 1024 ||
    !Number.isSafeInteger(config.minimumAvailableDiskMiB) ||
    config.minimumAvailableDiskMiB < 4096
  )
    throw new Error('Updater requires a storage workspace and explicit memory/disk floors');
}
export async function cleanupUpdateWorkspaces(workRoot) {
  for (const entry of await fs.readdir(workRoot, { withFileTypes: true }))
    if (entry.isDirectory() && /^build-[a-zA-Z0-9]{6}$/.test(entry.name))
      await removeBuildWorkspace(path.join(workRoot, entry.name), workRoot);
}
export async function approvedMain(config, request = fetch) {
  if (
    !repositoryPattern.test(config.repository) ||
    !/^[a-zA-Z0-9_.-]+\.ya?ml$/.test(config.workflow)
  )
    throw new Error('Invalid GitHub update source');
  const base = `https://api.github.com/repos/${config.repository}`;
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'Preview-server-updater' };
  const read = async (url) => {
    const response = await request(url, { headers, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`GitHub metadata returned HTTP ${response.status}`);
    return response.json();
  };
  const ref = await read(base + '/git/ref/heads/main');
  const commit = ref.object?.sha;
  if (!shaPattern.test(commit || '')) throw new Error('GitHub main did not return a commit');
  const runs = await read(
    base + `/actions/workflows/${config.workflow}/runs?branch=main&event=push&per_page=5`,
  );
  const run = runs.workflow_runs?.find(
    (item) =>
      item.head_sha === commit &&
      item.head_branch === 'main' &&
      item.event === 'push' &&
      item.head_repository?.full_name?.toLowerCase() === config.repository.toLowerCase(),
  );
  if (!run || run.status !== 'completed' || run.conclusion !== 'success') return null;
  if (!Number.isSafeInteger(run.id) || run.id < 1) throw new Error('Invalid approved workflow sequence');
  return { commit, sequence: run.id };
}
export async function updateFromGithub(config, { request = fetch } = {}) {
  const deploy = await readDeploymentConfig(config.deployConfig);
  validateWorkspace(config, deploy);
  const approved = await approvedMain(config, request);
  if (!approved) {
    console.log('Waiting for a successful main workflow.');
    return { status: 'waiting-for-ci' };
  }
  // Reserve host capacity before decoding the private business sources into memory.
  const [meminfo, status] = await Promise.all([
    fs.readFile('/proc/meminfo', 'utf8'),
    fs.readFile('/proc/self/status', 'utf8'),
  ]);
  // This process is already inside MemoryMax. Count its allocated anonymous pages
  // toward that same build budget, without counting reclaimable file mappings twice.
  const available =
    (Number(/^MemAvailable:\s+(\d+)/m.exec(meminfo)?.[1] || 0) +
      Number(/^RssAnon:\s+(\d+)/m.exec(status)?.[1] || 0)) /
    1024;
  if (available < config.minimumAvailableMemoryMiB) {
    const capacity = {
      availableMemoryMiB: Math.floor(available),
      requiredMemoryMiB: config.minimumAvailableMemoryMiB,
    };
    console.log(`Deferring build until sufficient memory is available: ${JSON.stringify(capacity)}`);
    return { status: 'waiting-for-memory', ...capacity };
  }
  const disk = await fs.statfs(deploy.storageRoot);
  if ((disk.bavail * disk.bsize) / (1024 * 1024) < config.minimumAvailableDiskMiB) {
    console.log('Deferring build until sufficient disk space is available.');
    return { status: 'waiting-for-disk' };
  }
  const businessGit = config.businessGit ? privateGit(config.businessGit) : null;
  const businessCommit = businessGit ? await businessGit.head() : null;
  const stateFile = path.join(deploy.stateRoot, 'auto-update.json');
  const state = await readJson(stateFile);
  const current = await readJson(path.join(deploy.releaseRoot, 'current.json'));
  if (
    businessGit &&
    state?.commit === approved.commit &&
    state.businessCommit === businessCommit &&
    state.releaseId === current?.releaseId
  ) {
    console.log('Framework and private business Git are current.');
    return { status: 'current', releaseId: current.releaseId };
  }
  const fixedBusiness = businessGit ? null : await readBusinessPackage(config.businessPackage);
  if (
    fixedBusiness &&
    state?.commit === approved.commit &&
    state.businessVersion === fixedBusiness.version &&
    state.releaseId === current?.releaseId
  ) {
    console.log('Framework and fixed business package are current.');
    return { status: 'current', releaseId: current.releaseId };
  }
  await fs.mkdir(config.workRoot, { recursive: true, mode: 0o700 });
  if ((await fs.realpath(config.workRoot)) !== path.resolve(config.workRoot))
    throw new Error('Updater workspace must not be a symbolic link');
  const workspace = await fs.mkdtemp(path.join(config.workRoot, 'build-'));
  const source = path.join(workspace, 'source');
  const nodeDirectory = path.dirname(process.execPath);
  const env = {
    ...process.env,
    PATH: nodeDirectory + path.delimiter + process.env.PATH,
    GIT_TERMINAL_PROMPT: '0',
    npm_config_cache: path.join(config.workRoot, 'npm-cache'),
  };
  const log = path.join(config.workRoot, 'last-build.log');
  const run = async (command, args, cwd = source) => {
    try {
      const result = await execute(command, args, {
        cwd,
        env,
        timeout: 25 * 60 * 1000,
        maxBuffer: 16 * 1024 * 1024,
      });
      await fs.appendFile(log, result.stdout + result.stderr);
      return result;
    } catch (error) {
      await fs.appendFile(log, (error.stdout || '') + (error.stderr || '') + String(error) + '\n');
      throw new Error(`Update command failed: ${command} ${args[0]}; inspect last-build.log`, {
        cause: error,
      });
    }
  };
  const guard = async () => {
    if (
      !Array.isArray(config.guardCommand) ||
      !config.guardCommand.length ||
      !config.guardCommand.every((value) => typeof value === 'string' && value.length)
    )
      throw new Error('An explicit server protection command is required');
    await run(config.guardCommand[0], config.guardCommand.slice(1), workspace);
  };
  const pageCatalog = async (projectId) => {
    const url = new URL('/api/native/showcase', deploy.healthUrl);
    url.searchParams.set('projectId', projectId);
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('Business page catalog is unavailable');
    const result = await response.json();
    if (!Array.isArray(result.pages)) throw new Error('Business page catalog is invalid');
    return result.pages
      .map(({ clientId, pageKey, allowed }) => ({ clientId, pageKey, allowed }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  };
  try {
    const business = fixedBusiness ?? (await readBusinessPackage(
      await businessGit.checkoutPackage(workspace, businessCommit),
    ));
    const projectId = business.registration.module.projectId;
    if (businessGit && projectId !== businessGit.projectId)
      throw new Error('Private business package does not match the configured project');
    await fs.writeFile(log, `Commit ${approved.commit}\nBusiness ${business.version}\n`, { mode: 0o600 });
    if (
      businessGit &&
      state?.commit === approved.commit &&
      state.businessVersion === business.version &&
      state.releaseId === current?.releaseId
    ) {
      await writeJson(stateFile, { ...state, businessCommit });
      return { status: 'current', releaseId: current.releaseId };
    }
    await guard();
    console.log(
      `Building approved framework ${approved.commit.slice(0, 12)} with business ${business.version.slice(0, 12)}`,
    );
    await run('git', ['init', '--quiet', source], workspace);
    await run('git', [
      'fetch',
      '--quiet',
      '--depth=1',
      `https://github.com/${config.repository}.git`,
      approved.commit,
    ]);
    await run('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD']);
    if ((await run('git', ['rev-parse', 'HEAD'])).stdout.trim() !== approved.commit)
      throw new Error('Fetched source differs from approved main');
    await applyBusinessPackage(source, business);
    const npm = path.resolve(nodeDirectory, '../lib/node_modules/npm/bin/npm-cli.js');
    console.log('Installing locked build dependencies.');
    await run(process.execPath, [npm, 'ci', '--no-audit', '--no-fund']);
    console.log('Building the application.');
    await run(process.execPath, [npm, 'run', 'build:web']);
    await run(process.execPath, [npm, 'run', 'build:runtime']);
    if ((await run('git', ['status', '--porcelain', '--untracked-files=no'])).stdout.trim())
      throw new Error('Build changed tracked source');
    const destination = path.join(workspace, 'releases');
    await fs.mkdir(destination);
    const ui = JSON.parse(
      await fs.readFile(path.join(source, 'packages/preview-ui/source-manifest.json'), 'utf8'),
    );
    const packaged = await packageRelease({
      buildRoot: path.join(source, 'output/web'),
      runtimeRoot: path.join(source, 'output/runtime'),
      contentRoot: path.join(source, 'project-content'),
      destination,
      commit: approved.commit,
      uiCommit: ui.commit,
      dirty: false,
    });
    await verifyRelease(packaged.release);
    const again = await approvedMain(config, request);
    const businessChanged = businessGit
      ? (await businessGit.head()) !== businessCommit
      : (await readBusinessPackage(config.businessPackage)).version !== business.version;
    if (
      again?.commit !== approved.commit ||
      businessChanged
    )
      throw new Error('Main or the business package changed during build; defer to the next run');
    await guard();
    const beforePages = JSON.stringify(await pageCatalog(projectId));
    const archive = path.join(workspace, 'application.tar.gz');
    await run('tar', ['-czf', archive, '-C', destination, packaged.manifest.releaseId]);
    const pointer = await readJson(path.join(deploy.releaseRoot, 'current.json'));
    const sequence = Math.max(approved.sequence, (pointer?.sequence || 0) + 1);
    console.log('Deploying the verified application.');
    await deployRelease({
      config: deploy,
      archive,
      sequence,
      service: async (action) => {
        await run('sudo', ['-n', 'systemctl', action, deploy.service], workspace);
        if (action === 'start') {
          const transaction = await readJson(path.join(deploy.stateRoot, 'transaction.json'));
          const active = await readJson(path.join(deploy.releaseRoot, 'current.json'));
          const releaseId = transaction?.candidateReady ? transaction.releaseId : active?.releaseId;
          const manifest = await verifyRelease(path.join(deploy.releaseRoot, releaseId));
          await checkHealth(deploy, manifest);
          if (JSON.stringify(await pageCatalog(projectId)) !== beforePages)
            throw new Error('Business pages or public permissions changed; reject candidate');
        }
      },
    });
    const next = {
      commit: approved.commit,
      businessVersion: business.version,
      ...(businessCommit ? { businessCommit } : {}),
      releaseId: packaged.manifest.releaseId,
      sequence,
      updatedAt: new Date().toISOString(),
    };
    await writeJson(stateFile, next);
    await guard();
    console.log(`FRAMEWORK_UPDATE_COMPLETE ${next.releaseId}`);
    return { status: 'deployed', ...next };
  } finally {
    await removeBuildWorkspace(workspace, config.workRoot);
  }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (!args.includes('--config'))
    throw new Error('Usage: github-update.mjs --config <root-owned-config.json>');
  const filename = args[args.indexOf('--config') + 1];
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error('Updater configuration must be a regular file');
  const config = JSON.parse(await fs.readFile(filename, 'utf8'));
  if (args.includes('--cleanup')) {
    validateWorkspace(config, await readDeploymentConfig(config.deployConfig));
    await cleanupUpdateWorkspaces(config.workRoot);
  } else console.log(JSON.stringify(await updateFromGithub(config)));
}
