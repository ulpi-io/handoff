// git.mjs — ground-truth helpers. A build handoff is verified by the diff it actually produced,
// not by what the delegated agent claims. Everything here is read-only observation of the repo.
import { spawnSync } from 'node:child_process';

function git(cwd, args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  return { code: r.status ?? 1, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

export function isRepo(cwd) {
  return git(cwd, ['rev-parse', '--is-inside-work-tree']).out === 'true';
}

// The pre-handoff HEAD. A build handoff records this so the caller can see exactly what the
// delegated agent changed (`git diff --stat <baseline>`), rather than trusting a self-report.
export function headSha(cwd) {
  const r = git(cwd, ['rev-parse', 'HEAD']);
  return r.code === 0 ? r.out : null;
}

// What changed since the baseline: the honest evidence a build handoff landed anything at all.
export function diffStat(cwd, baseline) {
  if (!baseline) return { changed: false, stat: '', files: [] };
  const stat = git(cwd, ['diff', '--stat', baseline]).out;
  const names = git(cwd, ['diff', '--name-only', baseline]).out;
  const files = names ? names.split('\n').filter(Boolean) : [];
  return { changed: files.length > 0, stat, files };
}
