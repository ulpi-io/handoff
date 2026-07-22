import { randomUUID } from 'node:crypto';
import { constants, copyFileSync, openSync, closeSync, fstatSync, readFileSync, chmodSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { ContractError, parseMcpDescriptor, sha256 } from './contracts.mjs';
import { safeRequestPath } from './paths.mjs';

export const GRANT_CAPABILITIES = Object.freeze({
  codex: Object.freeze({ bash: true, bashDisable: true, webSearch: false, mcp: true, write: true, nestedSource: true, nativeFilesystemIsolation: true, nativeBashSandbox: true }),
  grok: Object.freeze({ bash: true, bashDisable: true, webSearch: true, mcp: false, write: true, nestedSource: true, nativeFilesystemIsolation: true, nativeBashSandbox: true }),
  kiro: Object.freeze({ bash: true, bashDisable: true, webSearch: false, mcp: false, write: true, nestedSource: true, nativeFilesystemIsolation: false, nativeBashSandbox: false }),
  claude: Object.freeze({ bash: true, bashDisable: true, webSearch: true, mcp: true, write: true, nestedSource: true, nativeFilesystemIsolation: false, nativeBashSandbox: true }),
  opencode: Object.freeze({ bash: true, bashDisable: true, webSearch: true, mcp: true, write: true, nestedSource: true, nativeFilesystemIsolation: false, nativeBashSandbox: false }),
  cursor: Object.freeze({ bash: true, bashDisable: false, webSearch: false, mcp: true, write: true, nestedSource: true, nativeFilesystemIsolation: true, nativeBashSandbox: true }),
});

function boolean(value, label, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new ContractError(`${label} must be a boolean`);
  return value;
}

function assertAttenuated(key, value, parent) {
  if (parent && value && !parent[key]) throw new ContractError(`nested request cannot expand parent ${key} grant`);
}

function privateMcpCopy(path, tempRoot) {
  if (!tempRoot || !isAbsolute(tempRoot)) throw new ContractError('private MCP copying requires an absolute supervisor temp root');
  const canonical = safeRequestPath(path);
  const beforeFd = openSync(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  let before;
  let bytes;
  try {
    before = fstatSync(beforeFd);
    if (!before.isFile() || before.size > 256_000) throw new ContractError('MCP descriptor must be a regular file no larger than 256000 bytes');
    bytes = readFileSync(beforeFd);
  } finally {
    closeSync(beforeFd);
  }
  const descriptor = parseMcpDescriptor(bytes);
  const afterFd = openSync(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  let after;
  try { after = fstatSync(afterFd); }
  finally { closeSync(afterFd); }
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new ContractError('MCP descriptor changed while being copied');
  }
  const target = join(tempRoot, `mcp-${sha256(bytes).slice(7, 23)}-${randomUUID()}.json`);
  copyFileSync(canonical, target, constants.COPYFILE_EXCL);
  chmodSync(target, 0o600);
  const copied = readFileSync(target);
  if (sha256(copied) !== sha256(bytes)) throw new ContractError('private MCP descriptor copy failed identity verification');
  return { descriptor, path: target, digest: sha256(bytes), servers: descriptor.servers.map((server) => server.name) };
}

export function resolveGrants({ operation, mode = null, targetHarness, bash, webSearch, mcpConfig, parent = null, tempRoot = null }) {
  const capability = GRANT_CAPABILITIES[targetHarness];
  if (!capability) throw new ContractError(`unknown target harness: ${targetHarness}`);
  const requested = {
    bash: boolean(bash, '--bash', true),
    webSearch: boolean(webSearch, '--web-search', false),
    mcp: Boolean(mcpConfig),
  };
  const write = operation === 'handoff' && (mode === 'build' || mode === 'phase');
  const resolved = { ...requested, write };
  if (!requested.bash && !capability.bashDisable) throw new ContractError(`bash=false is unsupported for ${targetHarness}`);
  for (const key of ['bash', 'webSearch', 'mcp', 'write']) assertAttenuated(key, resolved[key], parent?.resolved);
  for (const key of ['bash', 'webSearch', 'mcp', 'write']) {
    if (resolved[key] && !capability[key]) throw new ContractError(`${key} is unsupported for ${targetHarness}`);
  }
  if (operation === 'advice' && resolved.write) throw new ContractError('advice is always read-only');
  if ((mode === 'review' || mode === 'verify') && resolved.write) throw new ContractError(`${mode} is always read-only`);

  let mcp = { digest: null, servers: [] };
  let internal = { mcpDescriptor: null, mcpPrivatePath: null };
  if (mcpConfig) {
    const copied = privateMcpCopy(mcpConfig, tempRoot);
    mcp = { digest: copied.digest, servers: copied.servers };
    internal = { mcpDescriptor: copied.descriptor, mcpPrivatePath: copied.path };
  }
  const attenuated = Boolean(parent);
  return {
    receipt: Object.freeze({
      requested: Object.freeze(requested),
      resolved: Object.freeze(resolved),
      provenance: Object.freeze({
        bash: attenuated ? 'parent-attenuated' : (bash === undefined ? 'operation-default' : 'explicit'),
        webSearch: attenuated ? 'parent-attenuated' : (webSearch === undefined ? 'operation-default' : 'explicit'),
        mcp: attenuated ? 'parent-attenuated' : (mcpConfig ? 'explicit' : 'operation-default'),
        write: attenuated ? 'parent-attenuated' : 'mode-derived',
      }),
      mcp: Object.freeze(mcp),
    }),
    internal,
  };
}

export function redactSecrets(value, maxBytes = 8192) {
  let text = String(value ?? '');
  let redactionCount = 0;
  const patterns = [
    /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu,
    /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/giu,
    /\bgh[pousr]_[A-Za-z0-9]{12,}\b/gu,
    /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+/giu,
  ];
  for (const pattern of patterns) text = text.replace(pattern, () => { redactionCount += 1; return '[REDACTED]'; });
  const bytes = Buffer.from(text);
  const truncated = bytes.length > maxBytes;
  if (truncated) text = `${bytes.subarray(0, maxBytes).toString('utf8')}…[truncated]`;
  return { text, redactionCount, truncated };
}
