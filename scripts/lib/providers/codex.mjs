// Strict Codex machine adapter: ephemeral, configuration-isolated, explicit native sandbox, and
// coordinator-bound AGENTS.md injection.
import { spawnSync } from 'node:child_process';
import { locateExecutable } from '../which.mjs';
import { flagPreflight } from '../provider-preflight.mjs';

export const id = 'codex';
export const displayName = 'Codex';
export const installHint = 'Install the Codex CLI (e.g. `brew install codex`) and run `codex login`.';

export function locate() {
  return locateExecutable('codex', ['/opt/homebrew/bin', '/usr/local/bin', '~/.codex/bin']);
}

export const pipelineRoles = Object.freeze(['build', 'phase', 'review', 'verify']);

export function pipelinePreflight(bin) {
  const flags = flagPreflight(bin, {
    helpArgs: ['exec', '--help'],
    requiredFlags: [
      '--config', '--strict-config', '--sandbox', '--cd', '--ephemeral', '--ignore-user-config', '--ignore-rules',
      '--disable', '--output-schema', '--output-last-message',
    ],
  });
  if (!flags.ok) return flags;

  // `--help` proves flags, but not whether this installed release recognizes the config keys that
  // suppress native AGENTS loading and pin network/approval policy. Add one deliberately unknown
  // key under --strict-config: a safe preflight must reject exactly that sentinel after accepting
  // every preceding required key, before auth or network initialization.
  const sentinel = 'handoff_capability_probe_unknown=true';
  const probe = spawnSync(bin, [
    'exec', '--strict-config', '--ignore-user-config',
    ...CODEX_CONFIG_OVERRIDES.flatMap((value) => ['--config', value]),
    '--config', sentinel,
    '--ephemeral', '-',
  ], {
    input: '',
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' },
  });
  const output = `${probe.stdout || ''}\n${probe.stderr || ''}`;
  if (probe.error || probe.status === 0 || !output.includes('handoff_capability_probe_unknown')) {
    return {
      ok: false,
      version: flags.version,
      reason: `installed CLI cannot prove required strict config support${probe.error ? `: ${probe.error.message}` : ''}`,
    };
  }
  return flags;
}

const CODEX_CONFIG_OVERRIDES = Object.freeze([
  'approval_policy="never"',
  'project_doc_max_bytes=0',
  'project_doc_fallback_filenames=[]',
  'project_root_markers=[".git"]',
  'sandbox_workspace_write.network_access=false',
]);

function mcpOverrides(descriptor) {
  if (!descriptor) return { config: [], env: {} };
  const config = [];
  const env = {};
  for (const server of descriptor.servers) {
    const prefix = `mcp_servers.${server.name}`;
    if (server.transport === 'stdio') {
      config.push(`${prefix}.command=${JSON.stringify(server.command)}`);
      config.push(`${prefix}.args=${JSON.stringify(server.args)}`);
      const names = [];
      for (const [target, reference] of Object.entries(server.env)) {
        if (process.env[reference.fromEnv] === undefined) throw new Error(`MCP environment reference '${reference.fromEnv}' is unavailable`);
        env[target] = process.env[reference.fromEnv];
        names.push(target);
      }
      if (names.length) config.push(`${prefix}.env_vars=${JSON.stringify(names)}`);
    } else {
      config.push(`${prefix}.url=${JSON.stringify(server.url)}`);
      const headerNames = Object.keys(server.headers);
      if (headerNames.some((name) => name.toLowerCase() !== 'authorization') || headerNames.length > 1) throw new Error('Codex private HTTP MCP supports only an Authorization environment reference');
      if (headerNames.length === 1) {
        const source = server.headers[headerNames[0]].fromEnv;
        if (process.env[source] === undefined) throw new Error(`MCP environment reference '${source}' is unavailable`);
        config.push(`${prefix}.bearer_token_env_var=${JSON.stringify(source)}`);
      }
    }
  }
  return { config, env };
}

export function pipelinePolicy(role, coordinatorApproval = null) {
  const sandbox = role === 'build' || role === 'phase' ? 'workspace-write' : 'read-only';
  const policy = {
    enforcement: 'native-filesystem-sandbox',
    filesystem: sandbox,
    approvals: 'never',
    ephemeral: true,
    userConfiguration: 'ignored',
    projectRules: coordinatorApproval ? 'coordinator-approved-and-injected' : 'coordinator-approval-required',
    nativeFilesystemIsolation: true,
    nativeAgentsLoading: 'disabled-by-project_doc_max_bytes=0',
    execPolicyRules: 'ignored',
    network: 'blocked',
    coordinatorApprovalRequired: true,
  };
  if (coordinatorApproval) {
    policy.coordinatorApprovalId = coordinatorApproval.approvalId;
    policy.coordinatorApprovalIssuer = coordinatorApproval.issuer;
    policy.coordinatorApprovalScope = coordinatorApproval.scope;
    policy.coordinatorApprovalSubjectHash = coordinatorApproval.subjectHash;
    policy.agentsRulesDigest = coordinatorApproval.rulesDigest;
    policy.injectedAgentsRules = coordinatorApproval.rules.map((rule) => `${rule.source}:${rule.path}`);
    policy.agentsRulesCompleteness = 'repository rules driver-verified; external/global applicability coordinator-asserted';
  }
  return policy;
}

function nullable(schema) {
  if (typeof schema.type === 'string') return { ...schema, type: [schema.type, 'null'] };
  if (Array.isArray(schema.type)) return { ...schema, type: [...new Set([...schema.type, 'null'])] };
  return { anyOf: [schema, { type: 'null' }] };
}

function jsonType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  if (typeof value === 'number') return 'number';
  return typeof value;
}

function strictifyObjectProperties(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const result = { ...schema };
  if (result.type === undefined && Object.hasOwn(result, 'const')) result.type = jsonType(result.const);
  if (result.type === undefined && Array.isArray(result.enum) && result.enum.length) {
    const types = [...new Set(result.enum.map(jsonType))];
    result.type = types.length === 1 ? types[0] : types;
  }
  if (result.$defs) {
    result.$defs = Object.fromEntries(Object.entries(result.$defs).map(([key, value]) => [key, strictifyObjectProperties(value)]));
  }
  if (result.items) result.items = strictifyObjectProperties(result.items);
  for (const keyword of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(result[keyword])) result[keyword] = result[keyword].map(strictifyObjectProperties);
  }
  if (result.properties && typeof result.properties === 'object' && !Array.isArray(result.properties)) {
    const originallyRequired = new Set(Array.isArray(result.required) ? result.required : []);
    result.properties = Object.fromEntries(Object.entries(result.properties).map(([key, value]) => {
      const child = strictifyObjectProperties(value);
      return [key, originallyRequired.has(key) ? child : nullable(child)];
    }));
    result.required = Object.keys(result.properties);
  }
  return result;
}

export function pipelineOutputSchema(schema) {
  // OpenAI strict structured outputs require every object property to be listed in `required`.
  // Canonically optional Handoff fields become required-but-nullable only at this adapter edge.
  return strictifyObjectProperties(JSON.parse(JSON.stringify(schema)));
}

export function pipelineExtractResult(raw) {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); }
  catch { return { bytes }; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { bytes };
  for (const item of Array.isArray(value.evidence) ? value.evidence : []) {
    if (item && typeof item === 'object' && item.path === null) delete item.path;
  }
  for (const item of Array.isArray(value.findings) ? value.findings : []) {
    if (item && typeof item === 'object') {
      if (item.file === null) delete item.file;
      if (item.line === null) delete item.line;
    }
  }
  if (value.usage && typeof value.usage === 'object' && !Array.isArray(value.usage)) {
    for (const key of ['inputTokens', 'outputTokens', 'totalTokens']) if (value.usage[key] === null) delete value.usage[key];
  }
  return { bytes: Buffer.from(JSON.stringify(value)) };
}

export function pipelineInvocation({ bin, role, cwd, model, effort, schemaFile, lastMsgFile, coordinatorApproval, mcpDescriptor, bash = true }) {
  if (!coordinatorApproval) throw new Error('Codex pipeline invocation requires coordinator approval binding');
  const policy = pipelinePolicy(role, coordinatorApproval);
  const mcp = mcpOverrides(mcpDescriptor);
  const args = [
    'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--strict-config',
    ...CODEX_CONFIG_OVERRIDES.flatMap((value) => ['--config', value]),
    ...mcp.config.flatMap((value) => ['--config', value]),
    '--sandbox', policy.filesystem, '--cd', cwd,
    '--output-schema', schemaFile, '--output-last-message', lastMsgFile,
  ];
  if (model) args.push('--model', model);
  if (effort) args.push('--config', `model_reasoning_effort=${JSON.stringify(effort)}`);
  if (!bash) args.push('--disable', 'shell_tool');
  args.push('-');
  return { bin, args, env: mcp.env, stdin: 'prompt', resultSource: { type: 'file', path: lastMsgFile }, policy: { ...policy, mcpServers: mcpDescriptor?.servers.map((server) => server.name) ?? [] } };
}
