// Strict Kiro review adapter. Only canonical read-only tools are trusted; build/phase are not advertised.
import { ContractError, PROVIDER_OUTPUT_SCHEMA_VERSION, decodeUtf8 } from '../contracts.mjs';
import { locateExecutable } from '../which.mjs';
import { flagPreflight } from '../provider-preflight.mjs';

export const id = 'kiro';
export const displayName = 'Kiro';
export const installHint = 'Install the Kiro CLI (`kiro-cli`) and authenticate it.';
const ANSI_CSI = /\x1b\[[0-?]*[ -/]*[@-~]/gu;
const HANDOFF_OBJECT_START = /\{\s*"schemaVersion"\s*:\s*"handoff\.provider-output\.v0\.2"/gu;

export function locate() {
  return locateExecutable('kiro-cli', ['~/.local/bin', '/opt/homebrew/bin', '/usr/local/bin']);
}

export const pipelineRoles = Object.freeze(['review', 'verify']);

export function pipelinePreflight(bin) {
  return flagPreflight(bin, {
    helpArgs: ['chat', '--help'],
    requiredFlags: ['--no-interactive', '--trust-tools', '--wrap'],
  });
}

export function pipelinePolicy(role) {
  if (!pipelineRoles.includes(role)) throw new Error(`Kiro pipeline role '${role}' is unsupported`);
  return {
    enforcement: 'tool-permission-allowlist',
    filesystem: 'permission-only',
    nativeFilesystemIsolation: false,
    headlessAuthentication: 'active Kiro session or KIRO_API_KEY, using native CLI precedence',
    toolAllowlist: ['read', 'grep', 'glob'],
  };
}

export function pipelineInvocation({ bin, role, model, effort }) {
  const policy = pipelinePolicy(role);
  const args = ['chat', '--no-interactive', '--wrap', 'never', '--trust-tools=read,grep,glob'];
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  return {
    bin,
    args,
    env: { NO_COLOR: '1', TERM: 'dumb' },
    stdin: 'prompt',
    resultSource: { type: 'stdout' },
    policy,
  };
}

export function pipelineExtractResult(raw) {
  const text = decodeUtf8(raw, 'Kiro output', 'invalid_provider_output');
  const displayFree = text.replace(ANSI_CSI, '');
  const responseMarkers = [...displayFree.matchAll(/(?:^|\n)> /gu)];
  const finalMarker = responseMarkers.at(-1);
  const finalFrame = finalMarker
    ? displayFree.slice((finalMarker.index ?? 0) + finalMarker[0].length)
    : displayFree;
  const candidate = finalFrame.trim();
  if (!candidate) {
    throw new ContractError('Kiro output is missing after final-response normalization', 'invalid_provider_output');
  }

  // Kiro 2.13 can prefix the final response with a short narrative sentence even when instructed to
  // emit JSON only. Accept one terminal Handoff object, never a fenced object or trailing output.
  try {
    const exact = JSON.parse(candidate);
    if (exact && typeof exact === 'object' && !Array.isArray(exact)
      && exact.schemaVersion === PROVIDER_OUTPUT_SCHEMA_VERSION) {
      return { bytes: Buffer.from(candidate), usage: null, usageSource: null };
    }
  } catch { /* try the provider's observed preamble plus terminal-object form below */ }

  const terminalObjects = [];
  for (const match of candidate.matchAll(HANDOFF_OBJECT_START)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let index = match.index ?? 0; index < candidate.length; index += 1) {
      const char = candidate[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          end = index + 1;
          break;
        }
      }
    }
    if (end < 0 || candidate.slice(end).trim()) continue;
    const object = candidate.slice(match.index ?? 0, end);
    try {
      const parsed = JSON.parse(object);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        && parsed.schemaVersion === PROVIDER_OUTPUT_SCHEMA_VERSION) terminalObjects.push(object);
    } catch { /* downstream remains fail-closed */ }
  }
  if (terminalObjects.length !== 1) {
    throw new ContractError('Kiro final response must end with exactly one JSON object matching the Handoff schema', 'invalid_provider_output');
  }
  return { bytes: Buffer.from(terminalObjects[0]), usage: null, usageSource: null };
}
