import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  openSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, parse, resolve, sep } from 'node:path';

export class PathBoundaryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PathBoundaryError';
    this.code = 'unsafe_path';
  }
}

function validateLexicalAbsolute(path, label) {
  if (typeof path !== 'string' || !path) throw new PathBoundaryError(`${label} must be a non-empty absolute path`);
  if (!isAbsolute(path)) throw new PathBoundaryError(`${label} must be absolute`);
  if (/[\u0000-\u001f\u007f]/u.test(path)) throw new PathBoundaryError(`${label} contains control characters`);
  const root = parse(path).root;
  const rest = path.slice(root.length);
  if (rest.split(sep).some((part) => part === '' || part === '.' || part === '..')) {
    throw new PathBoundaryError(`${label} contains an unsafe path segment`);
  }
  return path;
}

function rejectFinalSymlink(path, label) {
  let stat;
  try { stat = lstatSync(path); }
  catch (error) { throw new PathBoundaryError(`${label} cannot be inspected: ${error.message}`); }
  if (stat.isSymbolicLink()) throw new PathBoundaryError(`${label} must not be a symbolic link`);
  return stat;
}

function rejectAncestorRedirection(path, canonical, label) {
  const normalized = resolve(path);
  if (normalized === canonical) return;
  // macOS exposes these stable system aliases as symlinks. Accept only their exact /private mapping;
  // any additional redirection deeper in the caller-controlled path still fails this equality.
  if (process.platform === 'darwin' && ['/var', '/tmp', '/etc'].some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`))) {
    if (`/private${normalized}` === canonical) return;
  }
  throw new PathBoundaryError(`${label} contains symbolic-link redirection in an ancestor`);
}

export function safeCwd(path) {
  validateLexicalAbsolute(path, '--cwd');
  const stat = rejectFinalSymlink(path, '--cwd');
  if (!stat.isDirectory()) throw new PathBoundaryError('--cwd must name a directory');
  const canonical = realpathSync(path);
  rejectAncestorRedirection(path, canonical, '--cwd');
  return canonical;
}

export function safeRequestPath(path) {
  validateLexicalAbsolute(path, '--request');
  const stat = rejectFinalSymlink(path, '--request');
  if (!stat.isFile()) throw new PathBoundaryError('--request must name a regular file');
  const canonical = realpathSync(path);
  rejectAncestorRedirection(path, canonical, '--request');
  return canonical;
}

export function reserveResultPath(path) {
  validateLexicalAbsolute(path, '--result');
  if (basename(path) === '' || basename(path) === '.' || basename(path) === '..') {
    throw new PathBoundaryError('--result must name a file');
  }
  if (existsSync(path)) {
    const stat = rejectFinalSymlink(path, '--result');
    if (!stat.isFile()) throw new PathBoundaryError('--result must name a regular file');
    throw new PathBoundaryError('--result already exists; refusing to overwrite it');
  }
  const parent = dirname(path);
  const parentStat = rejectFinalSymlink(parent, '--result parent');
  if (!parentStat.isDirectory()) throw new PathBoundaryError('--result parent must be a directory');
  const canonicalParent = realpathSync(parent);
  rejectAncestorRedirection(parent, canonicalParent, '--result parent');
  const canonical = resolve(canonicalParent, basename(path));
  let fd;
  try { fd = openSync(canonical, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600); }
  catch (error) { throw new PathBoundaryError(`cannot reserve --result: ${error.message}`); }
  const identity = statSync(canonical);
  return { path: canonical, fd, dev: identity.dev, ino: identity.ino };
}

export function writeReservedResult(reservation, bytes) {
  const current = lstatSync(reservation.path);
  if (current.isSymbolicLink() || current.dev !== reservation.dev || current.ino !== reservation.ino || current.size !== 0) {
    throw new PathBoundaryError('--result was replaced or modified during provider execution');
  }
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  let offset = 0;
  while (offset < buffer.length) offset += writeSync(reservation.fd, buffer, offset, buffer.length - offset);
  closeSync(reservation.fd);
  reservation.fd = null;
}

export function closeReservedResult(reservation) {
  if (reservation?.fd === null || reservation?.fd === undefined) return;
  try { closeSync(reservation.fd); } catch { /* best-effort close */ }
  reservation.fd = null;
}

export function createSupervisorRuntimeDirectory() {
  const base = join(tmpdir(), 'handoff-supervisors');
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const baseStat = lstatSync(base);
  if (baseStat.isSymbolicLink() || !baseStat.isDirectory() || (baseStat.mode & 0o077) !== 0 || baseStat.uid !== process.getuid?.()) {
    throw new PathBoundaryError('supervisor runtime base must be a current-user mode-0700 directory');
  }
  const directory = mkdtempSync(join(base, `handoff-v03-${process.getuid?.() ?? 'uid'}-${process.pid}-`));
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0) throw new PathBoundaryError('supervisor runtime directory is not private');
  return directory;
}

export function atomicWritePrivateFile(path, bytes) {
  validateLexicalAbsolute(path, 'private state path');
  const parent = dirname(path);
  const parentStat = lstatSync(parent);
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory() || (parentStat.mode & 0o077) !== 0 || parentStat.uid !== process.getuid?.()) {
    throw new PathBoundaryError('private state parent must be a current-user mode-0700 directory');
  }
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new PathBoundaryError('private state path must not be a symbolic link');
  const temporary = join(parent, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
    const written = lstatSync(path);
    if (!written.isFile() || written.isSymbolicLink() || (written.mode & 0o077) !== 0) throw new PathBoundaryError('private state file lost its safety properties');
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* exact temporary path only */ }
    throw error;
  }
}
