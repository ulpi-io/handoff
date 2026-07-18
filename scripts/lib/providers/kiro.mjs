// kiro.mjs — adapter for the Kiro CLI (verified against `kiro-cli chat --help`).
//   headless invoke : kiro-cli chat --no-interactive   (prompt read as literal bytes from stdin)
//   trust lever     : --trust-tools=fs_read[,fs_write][,execute_bash]   (never --trust-all-tools by default)
//   model : --model   effort : --effort   resume : -r / --resume-id <ID>
//   NOTE: kiro chat has no structured-output flag — findings come back as text (markdown); the
//   handoff-run skill asks for a JSON block in the prompt when structure is needed (prompt-contract).
import { spawnSync } from 'node:child_process';
import { locateExecutable } from '../which.mjs';

export const id = 'kiro';
export const displayName = 'Kiro';
export const installHint = 'Install the Kiro CLI (`kiro-cli`) and authenticate it.';

export function locate() {
  return locateExecutable('kiro-cli', ['~/.local/bin', '/opt/homebrew/bin', '/usr/local/bin']);
}

export function authOk(bin) {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
  if (r.status !== 0) return { ok: false, hint: 'kiro-cli is installed but not responding; check its auth.' };
  return { ok: true, note: 'auth is verified by kiro at run time; a logged-out CLI surfaces as a run failure.' };
}

// review = read + inspect (can run commands to look, cannot write); build = read/write/run.
function trustFor(verb) {
  return verb === 'build' ? 'fs_read,fs_write,execute_bash' : 'fs_read,execute_bash';
}

export function supportsResume() { return true; }

export function invocation({ verb, model, effort, mode, resume }) {
  const args = ['chat', '--no-interactive'];
  if (mode === 'autonomous') args.push('--trust-all-tools');
  else args.push(`--trust-tools=${trustFor(verb)}`);
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  if (resume) { if (typeof resume === 'string') args.push('--resume-id', resume); else args.push('-r'); }
  return {
    bin: locate(),
    args,
    stdin: 'file', // prompt piped to kiro-cli stdin — never on argv
    trustNote: mode === 'autonomous' ? '--trust-all-tools' : `--trust-tools=${trustFor(verb)}`,
  };
}

export function capture({ code, stdout, stderr }) {
  return { ran: true, ok: code === 0, text: (stdout || '').trim(), stderr: (stderr || '').trim() };
}
