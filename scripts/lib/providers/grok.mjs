// grok.mjs — adapter for the Grok CLI (verified against `grok --help`, "Grok Build TUI").
//   headless invoke : grok --prompt-file <PATH>   (single-turn; prompt bytes stay IN the file)
//   trust lever     : --permission-mode plan | auto | bypassPermissions
//   structured out  : --json-schema '<inline schema>' (implies --output-format json)
//   resume          : -r/--resume [SESSION_ID]   model : -m   effort : --effort
import { spawnSync } from 'node:child_process';
import { locateExecutable } from '../which.mjs';

export const id = 'grok';
export const displayName = 'Grok';
export const installHint = 'Install the Grok CLI and authenticate (`grok models` should list models when logged in).';

export function locate() {
  return locateExecutable('grok', ['~/.grok/bin', '/opt/homebrew/bin', '/usr/local/bin']);
}

export function authOk(bin) {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
  if (r.status !== 0) return { ok: false, hint: 'grok is installed but not responding; check `grok models`.' };
  return { ok: true, note: 'auth is verified by grok at run time; a logged-out CLI surfaces as a run failure.' };
}

function permissionFor(verb, mode) {
  if (mode === 'autonomous') return 'bypassPermissions';
  return verb === 'build' ? 'auto' : 'plan'; // plan mode is read-only for review
}

export function supportsResume() { return true; }

export function invocation({ verb, cwd, promptFile, model, effort, mode, resume, schemaJson }) {
  const perm = permissionFor(verb, mode);
  // prompt bytes are delivered as a FILE PATH, never on argv/stdin — --prompt-file is grok-native
  const args = ['--prompt-file', promptFile, '--cwd', cwd, '--permission-mode', perm];
  if (verb === 'review') {
    if (schemaJson) args.push('--json-schema', schemaJson); // implies --output-format json
    else args.push('--output-format', 'json');
  }
  if (model) args.push('-m', model);
  if (effort) args.push('--effort', effort);
  if (resume) { args.push('--resume'); if (typeof resume === 'string') args.push(resume); }
  return { bin: locate(), args, stdin: 'none', trustNote: `--permission-mode ${perm}` };
}

export function capture({ code, stdout, stderr, structured }) {
  const out = (stdout || '').trim();
  let findings = null;
  if (structured && out) { try { findings = JSON.parse(out); } catch { /* leave as text */ } }
  return { ran: true, ok: code === 0, text: out, findings, stderr: (stderr || '').trim() };
}
