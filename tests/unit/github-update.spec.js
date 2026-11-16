// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { approvedMain, cleanupUpdateWorkspaces, updateFromGithub } from '../../scripts/github-update.mjs';
import {
  packageBusiness,
  readBusinessPackage,
  applyBusinessPackage,
} from '../../scripts/business-package.mjs';
import { TEST_PROJECT, writeTestProject } from '../fixtures/project-catalog.js';

const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== tmpdir() || !path.basename(root).startsWith('preview-update-test-'))
      throw new Error('Unsafe update fixture cleanup');
    await fs.rm(root, { recursive: true, force: true });
  }
});
async function json(filename, value) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, JSON.stringify(value));
}
async function fixture() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'preview-update-test-'));
  roots.push(root);
  const input = path.join(root, 'private');
  const checkout = path.join(root, 'checkout');
  const registration = structuredClone(TEST_PROJECT);
  registration.module.contentKey = 'fixture';
  await writeTestProject(input);
  const catalog = path.join(input, 'packages/platform-contracts/src');
  await json(path.join(catalog, 'registered-projects.local.json'), [registration]);
  await json(path.join(catalog, 'builtin-modules.local.json'), []);
  for (const page of registration.module.pages) {
    const filename = path.join(input, 'apps/web/src/project-modules/fixture', page.key, page.source);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, "import SharedPage from '../SharedPage'; export default SharedPage;");
  }
  await fs.writeFile(
    path.join(input, 'apps/web/src/project-modules/fixture/SharedPage.tsx'),
    'export default function SharedPage() { return null; }',
  );
  await json(path.join(input, 'project-content/fixture/manifest.json'), {
    schemaVersion: 1,
    contentKey: 'fixture',
    moduleKey: 'fixture-module',
    title: 'Private fixture',
    overview: 'overview.md',
    requirements: [],
    assets: [],
  });
  await fs.writeFile(path.join(input, 'project-content/fixture/overview.md'), '# Private fixed content');
  const publicProject = {
    schemaVersion: 1,
    module: {
      key: 'public-sample',
      projectId: 'public-sample',
      clientId: 'operation',
      label: 'Updated framework sample',
      surface: 'showcase',
      pages: [],
    },
    registry: [],
  };
  await json(path.join(checkout, 'packages/platform-contracts/src/registered-projects.json'), [
    publicProject,
  ]);
  await json(path.join(checkout, 'packages/platform-contracts/src/builtin-modules.json'), []);
  const filename = path.join(root, 'business.json');
  const packaged = await packageBusiness({ root: input, projectId: 'fixture', output: filename });
  return { root, input, checkout, filename, packaged };
}
test('a fixed business package preserves exact sources while adopting current public registration', async () => {
  const item = await fixture();
  const business = await readBusinessPackage(item.filename);
  expect(business.files.some((file) => file.path.endsWith('/SharedPage.tsx'))).toBe(true);
  await applyBusinessPackage(item.checkout, business);
  const catalog = JSON.parse(
    await fs.readFile(
      path.join(item.checkout, 'packages/platform-contracts/src/registered-projects.local.json'),
      'utf8',
    ),
  );
  expect(catalog.map((project) => project.module.label)).toEqual([
    'Updated framework sample',
    'Synthetic library',
  ]);
  expect(catalog[1].module.initialClients[0].pages[1].access).toBe('restricted');
  for (const file of business.files)
    expect(await fs.readFile(path.join(item.checkout, file.path))).toEqual(
      await fs.readFile(path.join(item.input, file.path)),
    );
  expect((await readBusinessPackage(item.filename)).version).toBe(item.packaged.version);
});
test('altered source bytes are rejected before business inputs are applied', async () => {
  const item = await fixture();
  const business = JSON.parse(await fs.readFile(item.filename, 'utf8'));
  business.files[0].content = Buffer.from('changed').toString('base64');
  await json(item.filename, business);
  await expect(readBusinessPackage(item.filename)).rejects.toThrow('checksum');
});
test.each(['../../.ssh/authorized_keys', 'apps/api/main.mjs', 'project-content/fixture/../../.env'])(
  'business package rejects an escaping or framework-owned destination %s',
  async (destination) => {
    const item = await fixture();
    const business = JSON.parse(await fs.readFile(item.filename, 'utf8'));
    business.files[0].path = destination;
    await json(item.filename, business);
    await expect(readBusinessPackage(item.filename)).rejects.toThrow('path');
  },
);
test('business inputs cannot overwrite framework source already in a fresh checkout', async () => {
  const item = await fixture();
  const business = await readBusinessPackage(item.filename);
  const destination = path.join(item.checkout, business.files[0].path);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, 'framework-owned bytes');
  await expect(applyBusinessPackage(item.checkout, business)).rejects.toMatchObject({ code: 'EEXIST' });
  expect(await fs.readFile(destination, 'utf8')).toBe('framework-owned bytes');
});
test('business input cannot follow a checkout junction outside the source tree', async () => {
  const item = await fixture();
  const outside = path.join(item.root, 'outside');
  await fs.mkdir(outside);
  const destination = path.join(item.checkout, 'apps/web/src/project-modules');
  await fs.mkdir(destination, { recursive: true });
  await fs.symlink(outside, path.join(destination, 'fixture'), 'junction');
  await expect(applyBusinessPackage(item.checkout, await readBusinessPackage(item.filename))).rejects.toThrow(
    'destination',
  );
  expect(await fs.readdir(outside)).toEqual([]);
});
const config = { repository: 'owner/preview', workflow: 'release.yml' };
const commit = 'a'.repeat(40);
function workflow(overrides = {}) {
  return {
    id: 42,
    head_sha: commit,
    head_branch: 'main',
    event: 'push',
    head_repository: { full_name: config.repository },
    status: 'completed',
    conclusion: 'success',
    ...overrides,
  };
}
function github(run) {
  return async (url) => ({
    ok: true,
    json: async () => (url.includes('/git/ref/') ? { object: { sha: commit } } : { workflow_runs: [run] }),
  });
}
test('only a successful workflow for current main in the configured repository approves an update', async () => {
  expect(await approvedMain(config, github(workflow()))).toEqual({ commit, sequence: 42 });
});
test.each([
  { status: 'in_progress', conclusion: null },
  { conclusion: 'failure' },
  { head_sha: 'b'.repeat(40) },
  { head_branch: 'unreviewed' },
  { event: 'pull_request' },
  { head_repository: { full_name: 'fork/preview' } },
])('unapproved or obsolete GitHub run is deferred %#', async (overrides) => {
  expect(await approvedMain(config, github(workflow(overrides)))).toBeNull();
});
test('GitHub access errors remain visible and never approve a deployment', async () => {
  await expect(approvedMain(config, async () => ({ ok: false, status: 403 }))).rejects.toThrow('403');
});
test('interrupted updater cleanup removes only its managed build directories', async () => {
  const item = await fixture();
  const workRoot = path.join(item.root, 'updater');
  await fs.mkdir(path.join(workRoot, 'build-aBc123'), { recursive: true });
  await fs.writeFile(path.join(workRoot, 'build-aBc123/source.txt'), 'temporary build');
  await fs.mkdir(path.join(workRoot, 'npm-cache'));
  await fs.writeFile(path.join(workRoot, 'npm-cache/cache.txt'), 'managed download cache');
  await cleanupUpdateWorkspaces(workRoot);
  expect(await fs.readdir(workRoot)).toEqual(['npm-cache']);
  expect(await fs.readFile(path.join(workRoot, 'npm-cache/cache.txt'), 'utf8')).toBe(
    'managed download cache',
  );
});
async function resourceFixture(availableMiB) {
  const item = await fixture();
  const installRoot = path.join(item.root, 'install');
  const storageRoot = path.join(item.root, 'storage');
  await fs.mkdir(storageRoot);
  await json(path.join(installRoot, 'releases/current.json'), { releaseId: 'aaaaaaaaaaaa-bbbbbbbbbbbb' });
  await json(path.join(installRoot, 'state/auto-update.json'), {
    commit,
    businessVersion: item.packaged.version,
    releaseId: 'aaaaaaaaaaaa-bbbbbbbbbbbb',
  });
  const deployConfig = path.join(item.root, 'deploy.json');
  await json(deployConfig, {
    schemaVersion: 1,
    installRoot,
    storageRoot,
    publicOrigin: 'http://127.0.0.1:41999',
    port: 41999,
    service: 'preview.service',
    node: process.execPath,
  });
  const read = fs.readFile.bind(fs);
  vi.spyOn(fs, 'readFile').mockImplementation((filename, ...args) => {
    if (filename === '/proc/meminfo')
      return Promise.resolve('MemAvailable: ' + availableMiB * 1024 + ' kB\n');
    if (filename === '/proc/self/status')
      return Promise.resolve('RssAnon: ' + 150 * 1024 + ' kB\nRssFile: ' + 80 * 1024 + ' kB\n');
    return read(filename, ...args);
  });
  vi.spyOn(fs, 'statfs').mockResolvedValue({ bavail: 10 * 1024 * 1024, bsize: 4096 });
  return {
    ...config,
    deployConfig,
    businessPackage: item.filename,
    workRoot: path.join(storageRoot, 'update'),
    minimumAvailableMemoryMiB: 5120,
    minimumAvailableDiskMiB: 6144,
  };
}
test('an already current release does not reserve the updater anonymous memory twice', async () => {
  const options = await resourceFixture(4990);
  expect(await updateFromGithub(options, { request: github(workflow()) })).toMatchObject({
    status: 'current',
  });
});
test('genuinely insufficient capacity defers before decoding private business input', async () => {
  const options = await resourceFixture(4400);
  options.businessPackage = path.join(tmpdir(), 'missing-business-package.json');
  expect(await updateFromGithub(options, { request: github(workflow()) })).toMatchObject({
    status: 'waiting-for-memory',
  });
});
