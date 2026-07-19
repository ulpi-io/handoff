// grok.mjs — adapter for the Grok CLI (verified against `grok --help`, "Grok Build TUI").
//   headless invoke : grok --prompt-file <PATH>   (single-turn; prompt bytes stay IN the file)
//   trust lever     : --permission-mode plan | auto | bypassPermissions
//   structured out  : --json-schema '<inline schema>' (implies --output-format json)
//   resume          : -r/--resume [SESSION_ID]   model : -m   effort : --effort
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { locateExecutable } from '../which.mjs';
import { flagPreflight } from '../provider-preflight.mjs';

export const id = 'grok';
export const displayName = 'Grok';
export const installHint = 'Install the Grok CLI and authenticate (`grok models` should list models when logged in).';
const PREFLIGHT_PROMPT = fileURLToPath(import.meta.url);

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

export const pipelineRoles = Object.freeze(['build', 'phase', 'review', 'verify']);

export function pipelinePreflight(bin) {
  const flags = flagPreflight(bin, {
    helpArgs: ['--help'],
    requiredFlags: [
      '--cwd', '--disable-web-search', '--json-schema', '--max-turns', '--no-memory',
      '--no-subagents', '--permission-mode', '--prompt-file', '--sandbox',
    ],
  });
  if (!flags.ok) return flags;

  for (const profile of ['workspace', 'read-only']) {
    // Invalid JSON forces a deterministic local parse failure after named-sandbox initialization,
    // without auth or network. Passing requires proof that this exact profile can initialize and
    // that the installed CLI reached its structured-result parser.
    const probe = spawnSync(bin, [
      '--sandbox', profile,
      '--prompt-file', PREFLIGHT_PROMPT,
      '--json-schema', 'handoff-invalid-json',
    ], {
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' },
    });
    const output = `${probe.stdout || ''}\n${probe.stderr || ''}`;
    const sandboxFailure = /sandbox.{0,160}(failed|unable|unavailable|unsupported|not (applied|enforced)|could not be applied|refusing to start)/iu.test(output);
    const structuredFailure = /json-schema.{0,160}invalid JSON/iu.test(output);
    if (probe.error || probe.status === 0 || sandboxFailure || !structuredFailure) {
      return {
        ok: false,
        version: flags.version,
        reason: `installed CLI cannot prove '${profile}' sandbox plus structured-result enforcement${probe.error ? `: ${probe.error.message}` : ''}`,
      };
    }
  }
  return flags;
}

export function pipelinePolicy(role) {
  const writable = role === 'build' || role === 'phase';
  return {
    enforcement: 'native-named-sandbox',
    sandboxProfile: writable ? 'workspace' : 'read-only',
    filesystem: writable ? 'workspace-write' : 'read-only',
    permissionMode: writable ? 'auto' : 'plan',
    webSearch: false,
    subagents: false,
    memory: false,
    maxTurns: 12,
    network: writable ? 'sandbox-profile-default' : 'blocked-for-children-on-supported-linux-only',
    readScope: 'provider-profile-defined-and-broader-than-cwd',
    writableLocations: writable ? ['cwd', 'provider-state', 'temporary-directories'] : ['provider-state', 'temporary-directories'],
  };
}

export function pipelineInvocation({ bin, role, cwd, promptFile, model, effort, schemaJson }) {
  const policy = pipelinePolicy(role);
  const args = [
    '--prompt-file', promptFile,
    '--cwd', cwd,
    '--sandbox', policy.sandboxProfile,
    '--permission-mode', policy.permissionMode,
    '--disable-web-search', '--no-subagents', '--no-memory',
    '--max-turns', String(policy.maxTurns),
    '--json-schema', schemaJson,
    '--verbatim',
  ];
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  return { bin, args, stdin: 'none', resultSource: { type: 'stdout' }, policy };
}

export function pipelineRuntimeCheck({ stderr }) {
  const text = String(stderr || '');
  if (/sandbox.{0,160}(failed|unable|unavailable|unsupported|not (applied|enforced)|continu(e|ing) without)/iu.test(text)) {
    return { ok: false, reason: 'Grok reported that its requested sandbox was not enforced' };
  }
  return { ok: true, reason: null };
}
