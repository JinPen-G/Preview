import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageBusiness, readBusinessPackage } from './business-package.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const projectId = process.argv[2];
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(projectId || ''))
  throw new Error('Usage: npm run business:push -- <project-id> [commit message]');
const checkout = path.join(root, '.preview-data', 'business-git', projectId);
if ((await fs.realpath(checkout)) !== path.resolve(checkout))
  throw new Error('The private publication checkout must be inside the local data directory');
const git = (args, options = {}) =>
  execFileSync('git', args, { cwd: checkout, encoding: 'utf8', ...options }).trim();
if (
  path.resolve(git(['rev-parse', '--show-toplevel'])) !== path.resolve(checkout) ||
  git(['branch', '--show-current']) !== 'main' ||
  git(['status', '--porcelain']).length
)
  throw new Error('The private publication checkout must be clean and on main');
const remote = git(['remote', 'get-url', '--push', 'origin']);
const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(remote);
if (!match || git(['remote', 'get-url', 'origin']) !== remote)
  throw new Error('Expected one private GitHub HTTPS address for fetch and push');

// Confirm visibility before the private snapshot is generated or sent to the remote.
const credential = git(['-c', 'credential.interactive=never', 'credential', 'fill'], {
  input: `url=${remote}\n\n`,
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
});
const token = /^password=(.+)$/m.exec(credential)?.[1];
if (!token) throw new Error('GitHub sign-in is required to verify repository visibility');
const response = await fetch(`https://api.github.com/repos/${match[1]}`, {
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  redirect: 'error',
  signal: AbortSignal.timeout(15000),
});
if (!response.ok || (await response.json()).private !== true)
  throw new Error('GitHub did not confirm that the publication destination is private');

git(['fetch', '--quiet', 'origin', 'main']);
git(['merge', '--ff-only', 'FETCH_HEAD']);
const unpublishedFiles = git(['log', '--format=', '--name-only', 'FETCH_HEAD..HEAD'])
  .split(/\r?\n/)
  .filter(Boolean);
if (
  git(['rev-list', '--count', '--merges', 'FETCH_HEAD..HEAD']) !== '0' ||
  unpublishedFiles.some((name) => name !== 'project.json')
)
  throw new Error('Unpublished commits must only contain the project package');
const snapshot = path.join(checkout, 'project.json');
const temporary = await fs.mkdtemp(path.join(checkout, '.package-'));
try {
  const output = path.join(temporary, 'project.json');
  const result = await packageBusiness({ root, projectId, output });
  const { size } = await fs.stat(output);
  if (size > 100 * 1024 * 1024) throw new Error('Private project package exceeds the GitHub Git file limit');
  if ((await readBusinessPackage(snapshot)).version !== result.version) {
    await fs.rename(output, snapshot);
    git(['add', '--', 'project.json']);
    git(['commit', '-m', process.argv.slice(3).join(' ') || `发布 ${projectId} 项目资料`]);
  }
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
git(['push', 'origin', 'HEAD:refs/heads/main']);
console.log(`已推送 ${projectId} 私有仓库 ${git(['rev-parse', '--short', 'HEAD'])}`);
