import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLE_VERSION } from './contracts.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const BUNDLE_FILES = Object.freeze([
  '.claude-plugin/plugin.json',
  '.codex-plugin/plugin.json',
  'commands/claude-build.md',
  'commands/claude-review.md',
  'commands/codex-build.md',
  'commands/codex-review.md',
  'commands/cursor-build.md',
  'commands/cursor-review.md',
  'commands/grok-build.md',
  'commands/grok-review.md',
  'commands/kiro-review.md',
  'commands/opencode-build.md',
  'commands/opencode-review.md',
  'contracts/v0.2/capabilities.schema.json',
  'contracts/v0.2/provider-output.schema.json',
  'contracts/v0.2/request.schema.json',
  'contracts/v0.2/result.schema.json',
  'contracts/v0.3/capabilities.schema.json',
  'contracts/v0.3/dag.schema.json',
  'contracts/v0.3/mcp.schema.json',
  'contracts/v0.3/provider-output.schema.json',
  'contracts/v0.3/request.schema.json',
  'contracts/v0.3/result.schema.json',
  'scripts/handoff.mjs',
  'scripts/prepare-request.mjs',
  'scripts/lib/agents-policy.mjs',
  'scripts/lib/bundle.mjs',
  'scripts/lib/capability-grants.mjs',
  'scripts/lib/contracts.mjs',
  'scripts/lib/dag.mjs',
  'scripts/lib/frontend.mjs',
  'scripts/lib/git.mjs',
  'scripts/lib/machine.mjs',
  'scripts/lib/nested-client.mjs',
  'scripts/lib/paths.mjs',
  'scripts/lib/provider-preflight.mjs',
  'scripts/lib/request-preparer.mjs',
  'scripts/lib/selection.mjs',
  'scripts/lib/supervisor.mjs',
  'scripts/lib/which.mjs',
  'scripts/lib/providers/claude.mjs',
  'scripts/lib/providers/codex.mjs',
  'scripts/lib/providers/cursor.mjs',
  'scripts/lib/providers/grok.mjs',
  'scripts/lib/providers/kiro.mjs',
  'scripts/lib/providers/opencode.mjs',
  'skills/get-advice/SKILL.md',
  'skills/get-advice/agents/openai.yaml',
  'skills/handoff-run/SKILL.md',
]);

export const BUNDLE_DIGEST_PATH = resolve(root, 'bundle-digest.json');

function add(hash, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const size = Buffer.allocUnsafe(8);
  size.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(size).update(bytes);
}
export function computeBundleDigest() {
  const hash = createHash('sha256');
  for (const file of BUNDLE_FILES) {
    add(hash, file);
    add(hash, readFileSync(resolve(root, file)));
  }
  return `sha256:${hash.digest('hex')}`;
}

export function readBundleDigest() {
  let manifest;
  try { manifest = JSON.parse(readFileSync(BUNDLE_DIGEST_PATH, 'utf8')); }
  catch (error) { throw new Error(`bundle digest manifest is unreadable: ${error.message}`); }
  const keys = Object.keys(manifest).sort();
  if (JSON.stringify(keys) !== JSON.stringify(['algorithm', 'bundleVersion', 'digest', 'files', 'schemaVersion'])) {
    throw new Error('bundle digest manifest has unknown or missing fields');
  }
  if (manifest.schemaVersion !== 'handoff.bundle-digest.v0.2' || manifest.bundleVersion !== BUNDLE_VERSION || manifest.algorithm !== 'sha256') {
    throw new Error('bundle digest manifest version drift');
  }
  if (JSON.stringify(manifest.files) !== JSON.stringify(BUNDLE_FILES)) throw new Error('bundle digest file-set drift');
  const computed = computeBundleDigest();
  if (manifest.digest !== computed) throw new Error('bundle digest mismatch');
  return manifest;
}
