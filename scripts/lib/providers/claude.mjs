import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ContractError,
  DEFAULT_MAX_TURNS,
  MAX_MAX_TURNS,
  MIN_MAX_TURNS,
  decodeUtf8,
} from '../contracts.mjs';
import { flagPreflight } from '../provider-preflight.mjs';
import { locateExecutable } from '../which.mjs';

export const id = 'claude';
export const displayName = 'Claude';
export const installHint = 'Install Claude Code (`npm i -g @anthropic-ai/claude-code`) and provide non-interactive authentication.';
export const pipelineRoles = Object.freeze(['build', 'phase', 'review', 'verify']);

const EMPTY_MCP = JSON.stringify({ mcpServers: {} });
const BUILD_TOOLS = Object.freeze(['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write']);
const REVIEW_TOOLS = Object.freeze(['Glob', 'Grep', 'Read']);

function writable(role) {
  return role === 'build' || role === 'phase';
}

function toolsFor(role, { bash = writable(role), webSearch = false, mcpDescriptor = null } = {}) {
  return [
    ...(writable(role) ? BUILD_TOOLS.filter((tool) => tool !== 'Bash') : REVIEW_TOOLS),
    ...(bash ? ['Bash'] : []),
    ...(webSearch ? ['WebSearch', 'WebFetch'] : []),
    ...(mcpDescriptor ? mcpDescriptor.servers.map((server) => `mcp__${server.name}__*`) : []),
  ];
}

function settingsJson({ cwd = null, canWrite = false } = {}) {
  return JSON.stringify({
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      excludedCommands: [],
      filesystem: { allowRead: cwd ? [cwd] : [], allowWrite: canWrite && cwd ? [cwd] : [], denyRead: [], denyWrite: !canWrite && cwd ? [cwd] : [] },
      network: { allowedDomains: [] },
    },
  });
}

export function locate() {
  return locateExecutable('claude', ['~/.local/bin', '~/.claude/local', '/opt/homebrew/bin', '/usr/local/bin']);
}

export function pipelinePreflight(bin) {
  const flags = flagPreflight(bin, {
    helpArgs: ['--help'],
    requiredFlags: [
      '--allowedTools', '--bare', '--disable-slash-commands', '--json-schema',
      '--mcp-config', '--no-chrome', '--no-session-persistence', '--output-format', '--permission-mode',
      '--safe-mode', '--settings', '--strict-mcp-config', '--tools',
    ],
  });
  if (!flags.ok) return flags;

  // Claude's official reference says --help is intentionally incomplete, so --max-turns is proved
  // here rather than by help text. Invalid schema parsing is a local, authentication-free proof that
  // this release accepted the complete strict invocation surface. Sandbox availability is then
  // fail-closed at run startup.
  const probe = spawnSync(bin, [
    '--bare', '--safe-mode', '--settings', settingsJson(), '--strict-mcp-config', '--mcp-config', EMPTY_MCP,
    '--disable-slash-commands', '--no-session-persistence', '--permission-mode', 'dontAsk',
    '--tools', 'Read', '--allowedTools', 'Read', '--max-turns', '1', '-p', '--output-format', 'json',
    '--json-schema', 'handoff-invalid-json',
  ], {
    input: '',
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' },
  });
  const output = `${probe.stdout || ''}\n${probe.stderr || ''}`;
  if (probe.error || probe.status === 0 || !/json-schema.{0,200}(invalid|JSON)/iu.test(output)) {
    return {
      ok: false,
      version: flags.version,
      reason: `installed CLI cannot prove bare-mode structured-result enforcement${probe.error ? `: ${probe.error.message}` : ''}`,
    };
  }
  return flags;
}

export function pipelinePolicy(role, maxTurns = DEFAULT_MAX_TURNS, { bash = writable(role), webSearch = false, mcpDescriptor = null } = {}) {
  const canWrite = writable(role);
  return {
    enforcement: canWrite ? 'native-bash-sandbox-plus-file-tool-permissions' : 'read-only-tool-allowlist',
    filesystem: canWrite ? 'project-write-by-default; managed policy remains authoritative' : 'read-only-tool-surface',
    approvals: 'never (dontAsk)',
    ephemeral: true,
    userConfiguration: 'disabled by bare and safe modes',
    managedConfiguration: 'honored by Claude Code',
    projectRules: 'disabled by bare mode',
    // Claude documents the native sandbox as a Bash/child-process boundary. Built-in file tools
    // remain permission-controlled, so the provider run as a whole is not labeled OS-isolated.
    nativeFilesystemIsolation: false,
    nativeBashSandbox: bash,
    fileToolConfinement: canWrite ? 'permission-controlled file tools plus fail-closed Bash sandbox' : (bash ? 'read-only file tool surface plus fail-closed Bash deny-write sandbox' : 'no edit, write, or bash tool exposed'),
    toolAllowlist: [...toolsFor(role, { bash, webSearch, mcpDescriptor })],
    webSearch,
    subagents: false,
    memory: false,
    maxTurns,
    maxTurnsConfigurable: true,
    maxTurnsMinimum: MIN_MAX_TURNS,
    maxTurnsMaximum: MAX_MAX_TURNS,
    network: webSearch ? 'Claude WebSearch/WebFetch enabled; Bash child network remains sandbox-denied' : (bash ? 'Bash child network denied; provider API remains reachable' : 'no network-capable tool exposed'),
    structuredResult: 'native JSON Schema in Claude JSON envelope',
  };
}

function materializeMcp(descriptor, tempRoot) {
  if (!descriptor) return EMPTY_MCP;
  const mcpServers = {};
  for (const server of descriptor.servers) {
    if (server.transport === 'stdio') {
      const env = {};
      for (const [target, reference] of Object.entries(server.env)) {
        if (process.env[reference.fromEnv] === undefined) throw new Error(`MCP environment reference '${reference.fromEnv}' is unavailable`);
        env[target] = process.env[reference.fromEnv];
      }
      mcpServers[server.name] = { command: server.command, args: server.args, env };
    } else {
      const headers = {};
      for (const [target, reference] of Object.entries(server.headers)) {
        if (process.env[reference.fromEnv] === undefined) throw new Error(`MCP environment reference '${reference.fromEnv}' is unavailable`);
        headers[target] = process.env[reference.fromEnv];
      }
      mcpServers[server.name] = { type: server.transport, url: server.url, headers };
    }
  }
  const path = join(tempRoot, 'claude-mcp.json');
  writeFileSync(path, `${JSON.stringify({ mcpServers })}\n`, { mode: 0o600, flag: 'wx' });
  return path;
}

export function pipelineInvocation({ bin, role, cwd, tempRoot, model, effort, schemaJson, maxTurns, bash = writable(role), webSearch = false, mcpDescriptor }) {
  const policy = pipelinePolicy(role, maxTurns ?? DEFAULT_MAX_TURNS, { bash, webSearch, mcpDescriptor });
  const tools = policy.toolAllowlist.join(',');
  const mcpConfig = materializeMcp(mcpDescriptor, tempRoot);
  const args = [
    '--bare', '--safe-mode', '--settings', settingsJson({ cwd, canWrite: writable(role) }),
    '--strict-mcp-config', '--mcp-config', mcpConfig,
    '--disable-slash-commands', '--no-session-persistence', '--no-chrome',
    '--permission-mode', 'dontAsk', '--tools', tools, '--allowedTools', tools,
    '--max-turns', String(policy.maxTurns), '-p', '--output-format', 'json', '--json-schema', schemaJson,
  ];
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  return { bin, args, stdin: 'prompt', resultSource: { type: 'stdout' }, policy };
}

function observedUsage(envelope) {
  const source = envelope?.usage;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const inputTokens = source.input_tokens ?? source.inputTokens;
  const outputTokens = source.output_tokens ?? source.outputTokens;
  if (!Number.isInteger(inputTokens) || inputTokens < 0 || !Number.isInteger(outputTokens) || outputTokens < 0) return null;
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

export function pipelineExtractResult(raw) {
  let envelope;
  const text = decodeUtf8(raw, 'Claude output', 'invalid_provider_output');
  try { envelope = JSON.parse(text); }
  catch { throw new ContractError('Claude output must be exactly one JSON envelope', 'invalid_provider_output'); }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || envelope.is_error === true) {
    throw new ContractError('Claude returned a malformed or error result envelope', 'invalid_provider_output');
  }
  if (!envelope.structured_output || typeof envelope.structured_output !== 'object' || Array.isArray(envelope.structured_output)) {
    throw new ContractError('Claude result envelope is missing structured_output', 'invalid_provider_output');
  }
  const usage = observedUsage(envelope);
  return {
    bytes: Buffer.from(JSON.stringify(envelope.structured_output)),
    usage,
    usageSource: usage ? 'provider-envelope' : null,
  };
}

export function pipelineRuntimeCheck({ stdout, stderr }) {
  const text = `${stdout || ''}\n${stderr || ''}`;
  if (/sandbox.{0,200}(failed|unable|unavailable|unsupported|continu(e|ing) without|could not be applied)/iu.test(text)) {
    return { ok: false, reason: 'Claude reported that its required Bash sandbox was not enforced' };
  }
  return { ok: true, reason: null };
}
