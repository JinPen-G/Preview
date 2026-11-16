/** Fixed business inputs are versioned separately from the public framework. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadProjectCatalog } from '../packages/platform-server/src/project-catalog.js';
import { loadContentPackage } from '../packages/project-core/src/platform/project-content.js';
import { validateProjectRegistrations } from '../packages/project-core/src/platform/project-registration.js';
import {
  resolveExistingPathInsideRoot,
  resolveWritablePathInsideRoot,
} from '../packages/project-core/src/filesystem.js';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const extensions = [
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.css',
  '.json',
  '.md',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.svg',
];
function packageVersion(registration, files) {
  return hash(JSON.stringify({ registration, files: files.map(({ path, sha256 }) => ({ path, sha256 })) }));
}
function allowedPath(registration, filename) {
  const { projectId, contentKey } = registration.module;
  return (
    typeof filename === 'string' &&
    !/[:\\%]/.test(filename) &&
    filename.split('/').every((part) => part && part !== '.' && part !== '..' && !part.startsWith('.')) &&
    [
      `apps/web/src/project-modules/${projectId}/`,
      `packages/component-library/src/${projectId}/`,
      `project-content/${contentKey}/`,
    ].some((prefix) => filename.startsWith(prefix)) &&
    extensions.includes(path.posix.extname(filename).toLowerCase())
  );
}
export function validateBusinessPackage(input) {
  if (
    input?.schemaVersion !== 1 ||
    !Array.isArray(input.files) ||
    !input.files.length ||
    input.files.length > 4000
  )
    throw new Error('Invalid business package');
  validateProjectRegistrations([input.registration], []);
  const names = new Set();
  let total = 0;
  for (const file of input.files) {
    if (
      !allowedPath(input.registration, file.path) ||
      names.has(file.path) ||
      typeof file.content !== 'string'
    )
      throw new Error('Invalid or repeated business source path');
    const bytes = Buffer.from(file.content, 'base64');
    total += bytes.length;
    if (
      bytes.length > 8 * 1024 * 1024 ||
      total > 128 * 1024 * 1024 ||
      bytes.toString('base64') !== file.content ||
      hash(bytes) !== file.sha256
    )
      throw new Error('Business source checksum mismatch or size limit exceeded');
    names.add(file.path);
  }
  if (input.version !== packageVersion(input.registration, input.files))
    throw new Error('Business package version mismatch');
  return input;
}
export async function readBusinessPackage(filename) {
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 192 * 1024 * 1024)
    throw new Error('Business package must be a regular file within the size limit');
  return validateBusinessPackage(JSON.parse(await fs.readFile(filename, 'utf8')));
}
export async function packageBusiness({ root, projectId, output }) {
  const catalog = await loadProjectCatalog(path.join(root, 'packages/platform-contracts/src'));
  const registration = catalog.projects.find((project) => project.module.projectId === projectId);
  if (!registration) throw new Error('Project is not explicitly registered');
  const names = new Set(registration.registry.flatMap((item) => item.files.map((file) => file.path)));
  // Page entrypoints may share project-local React adapters outside individual page folders.
  const pagesRoot = path.join(root, 'apps/web/src/project-modules', projectId);
  for (const entry of await fs.readdir(pagesRoot, { recursive: true, withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Business page sources must not contain symbolic links');
    if (entry.isFile())
      names.add(path.relative(root, path.join(entry.parentPath, entry.name)).replaceAll('\\', '/'));
  }
  for (const page of registration.module.pages)
    names.add(`apps/web/src/project-modules/${projectId}/${page.key}/${page.source}`);
  const content = await loadContentPackage(
    path.join(root, 'project-content'),
    registration.module.contentKey,
    catalog.moduleCatalog,
  );
  names.add(`project-content/${registration.module.contentKey}/manifest.json`);
  for (const name of content.files.keys())
    names.add(`project-content/${registration.module.contentKey}/${name}`);
  const files = [];
  for (const filename of [...names].sort()) {
    if (!allowedPath(registration, filename)) throw new Error('Business source leaves its project boundary');
    const source = await resolveExistingPathInsideRoot(root, filename, { allowedExtensions: extensions });
    if (!source) throw new Error('Business source is missing');
    const bytes = await fs.readFile(source);
    files.push({ path: filename, sha256: hash(bytes), content: bytes.toString('base64') });
  }
  const result = validateBusinessPackage({
    schemaVersion: 1,
    registration,
    files,
    version: packageVersion(registration, files),
  });
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(result) + '\n', { flag: 'wx', mode: 0o600 });
  return {
    version: result.version,
    projectId,
    pages: registration.module.pages.length,
    files: files.length,
    contentRevision: content.revision,
  };
}
export async function applyBusinessPackage(root, input) {
  validateBusinessPackage(input);
  const catalogDirectory = path.join(root, 'packages/platform-contracts/src');
  const publicProjects = JSON.parse(
    await fs.readFile(path.join(catalogDirectory, 'registered-projects.json'), 'utf8'),
  );
  const builtins = JSON.parse(await fs.readFile(path.join(catalogDirectory, 'builtin-modules.json'), 'utf8'));
  const projects = [...publicProjects, input.registration];
  validateProjectRegistrations(projects, builtins);
  for (const file of input.files) {
    const target = await resolveWritablePathInsideRoot(root, file.path, { allowedExtensions: extensions });
    if (!target) throw new Error('Business destination leaves the source tree');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from(file.content, 'base64'), { flag: 'wx', mode: 0o600 });
  }
  const local = await resolveWritablePathInsideRoot(
    root,
    'packages/platform-contracts/src/registered-projects.local.json',
    { allowedExtensions: ['.json'] },
  );
  if (!local) throw new Error('Local project catalog destination is unavailable');
  await fs.writeFile(local, JSON.stringify(projects, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
if (
  import.meta.previewBundled !== true &&
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const args = process.argv.slice(2);
  const value = (name) => args[args.indexOf(name) + 1];
  if (args[0] !== 'package' || !args.includes('--project') || !args.includes('--output'))
    throw new Error('Usage: business-package.mjs package --project <id> --output <private-file.json>');
  console.log(
    JSON.stringify(
      await packageBusiness({
        root: fileURLToPath(new URL('..', import.meta.url)),
        projectId: value('--project'),
        output: path.resolve(value('--output')),
      }),
    ),
  );
}
