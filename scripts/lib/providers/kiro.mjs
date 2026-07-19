// kiro.mjs — adapter for the Kiro CLI (verified against `kiro-cli chat --help`).
//   headless invoke : kiro-cli chat --no-interactive   (prompt read as literal bytes from stdin)
//   trust lever     : --trust-tools=fs_read[,fs_write][,execute_bash]   (never trust-all-tools)
//   model : --model   effort : --effort   resume : -r / --resume-id <ID>
//   NOTE: kiro chat has no structured-output flag — findings come back as text (markdown); the
//   handoff-run skill asks for a JSON block in the prompt when structure is needed (prompt-contract).
import { spawnSync } from 'node:child_process';
import { locateExecutable } from '../which.mjs';
import { flagPreflight } from '../provider-preflight.mjs';

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

// Review is intentionally fs_read only: execute_bash is not a read-only capability.
function trustFor(verb) {
  return verb === 'build' || verb === 'phase' ? 'fs_read,fs_write,execute_bash' : 'fs_read';
}

export function supportsResume() { return true; }

export function invocation({ verb, model, effort, mode, resume }) {
  const args = ['chat', '--no-interactive'];
  args.push(`--trust-tools=${trustFor(verb)}`);
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  if (resume) { if (typeof resume === 'string') args.push('--resume-id', resume); else args.push('-r'); }
  return {
    bin: locate(),
    args,
    stdin: 'file', // prompt piped to kiro-cli stdin — never on argv
    trustNote: `--trust-tools=${trustFor(verb)} (tool permission only; not filesystem isolation)`,
  };
}

export function capture({ code, stdout, stderr }) {
  return { ran: true, ok: code === 0, text: (stdout || '').trim(), stderr: (stderr || '').trim() };
}

export const pipelineRoles = Object.freeze(['build', 'phase', 'review', 'verify']);

export function pipelinePreflight(bin) {
  return flagPreflight(bin, {
    helpArgs: ['chat', '--help'],
    requiredFlags: ['--no-interactive', '--trust-tools'],
  });
}

export function pipelinePolicy(role, externalConfinement = null) {
  const writable = role === 'build' || role === 'phase';
  const base = {
    enforcement: 'tool-permission-allowlist',
    filesystem: 'permission-only',
    nativeFilesystemIsolation: false,
    toolAllowlist: writable ? ['fs_read', 'fs_write', 'execute_bash'] : ['fs_read'],
  };
  if (externalConfinement) {
    base.enforcement = 'external-confinement-receipt-plus-tool-permission-allowlist';
    base.filesystem = externalConfinement.policy;
    base.externalConfinement = {
      schemaVersion: externalConfinement.schemaVersion,
      receiptId: externalConfinement.receiptId,
      issuer: externalConfinement.issuer,
      policy: externalConfinement.policy,
      cwd: externalConfinement.cwd,
      verifiedByDriver: false,
    };
  }
  return base;
}

export function pipelineInvocation({ bin, role, model, effort, externalConfinement }) {
  const policy = pipelinePolicy(role, externalConfinement);
  const args = ['chat', '--no-interactive', '--wrap', 'never', `--trust-tools=${trustFor(role)}`];
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  return { bin, args, stdin: 'prompt', resultSource: { type: 'stdout' }, policy };
}
