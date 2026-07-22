import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipelineInvocation } from './lib/providers/opencode.mjs';

test('OpenCode uses isolated permission-only Bash, web, and MCP configuration', () => {
  const temp = mkdtempSync(join(tmpdir(), 'handoff-opencode-test-'));
  try {
    const invocation = pipelineInvocation({ bin: '/bin/opencode', role: 'review', cwd: process.cwd(), tempRoot: temp, model: 'model', effort: 'high', bash: true, webSearch: true, mcpDescriptor: { servers: [{ name: 'remote', transport: 'http', url: 'https://mcp.example.test', headers: {} }] } });
    const config = JSON.parse(invocation.env.OPENCODE_CONFIG_CONTENT);
    assert.equal(config.permission.bash, 'allow');
    assert.equal(config.permission.websearch, 'allow');
    assert.deepEqual(Object.keys(config.mcp), ['remote']);
    assert.equal(invocation.policy.nativeFilesystemIsolation, false);
    assert.equal(invocation.args.includes('--variant'), true);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
