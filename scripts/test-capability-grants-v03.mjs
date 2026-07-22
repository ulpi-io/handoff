import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveGrants, redactSecrets } from './lib/capability-grants.mjs';

test('grants resolve read-only advice and writable build independently', () => {
  const advice = resolveGrants({ operation: 'advice', targetHarness: 'grok' }).receipt;
  assert.deepEqual(advice.resolved, { bash: true, webSearch: false, mcp: false, write: false });
  const build = resolveGrants({ operation: 'handoff', mode: 'build', targetHarness: 'claude', webSearch: true }).receipt;
  assert.equal(build.resolved.write, true);
  assert.equal(build.resolved.webSearch, true);
  assert.throws(() => resolveGrants({ operation: 'advice', targetHarness: 'cursor', webSearch: true }), /unsupported/);
});

test('nested grants can only narrow the parent', () => {
  const parent = resolveGrants({ operation: 'advice', targetHarness: 'claude', bash: false }).receipt;
  assert.throws(() => resolveGrants({ operation: 'advice', targetHarness: 'claude', bash: true, parent }), /cannot expand/);
  const child = resolveGrants({ operation: 'advice', targetHarness: 'claude', bash: false, parent }).receipt;
  assert.equal(child.provenance.bash, 'parent-attenuated');
});

test('MCP bytes are privately copied and secrets are redacted', () => {
  const root = mkdtempSync(join(tmpdir(), 'handoff-grants-test-'));
  try {
    const source = join(root, 'source.json');
    writeFileSync(source, JSON.stringify({ schemaVersion: 'handoff.mcp.v0.3', servers: [{ name: 'local', transport: 'stdio', command: '/usr/bin/env', args: [], env: { TOKEN: { fromEnv: 'MCP_TOKEN' } } }] }), { mode: 0o600 });
    const value = resolveGrants({ operation: 'advice', targetHarness: 'claude', mcpConfig: source, tempRoot: root });
    assert.equal(value.receipt.resolved.mcp, true);
    assert.notEqual(value.internal.mcpPrivatePath, source);
    assert.equal(statSync(value.internal.mcpPrivatePath).mode & 0o077, 0);
    assert.deepEqual(readFileSync(value.internal.mcpPrivatePath), readFileSync(source));
    assert.equal(redactSecrets('api_key=super-secret-value Bearer abcdefghijklmnopqrstuvwxyz').redactionCount, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
