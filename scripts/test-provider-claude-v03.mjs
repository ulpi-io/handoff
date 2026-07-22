import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipelineInvocation } from './lib/providers/claude.mjs';

test('Claude maps sandboxed Bash, web tools, turns, and strict private MCP', () => {
  const temp = mkdtempSync(join(tmpdir(), 'handoff-claude-test-'));
  process.env.HANDOFF_TEST_MCP = 'secret';
  try {
    const invocation = pipelineInvocation({ bin: '/bin/claude', role: 'review', cwd: process.cwd(), tempRoot: temp, schemaJson: '{}', model: 'fable', effort: 'max', maxTurns: 32, bash: true, webSearch: true, mcpDescriptor: { servers: [{ name: 'local', transport: 'stdio', command: '/usr/bin/env', args: [], env: { TOKEN: { fromEnv: 'HANDOFF_TEST_MCP' } } }] } });
    assert.equal(invocation.policy.nativeBashSandbox, true);
    assert.equal(invocation.policy.nativeFilesystemIsolation, false);
    assert.equal(invocation.policy.toolAllowlist.includes('WebSearch'), true);
    assert.equal(invocation.policy.toolAllowlist.includes('Bash'), true);
    const mcpPath = invocation.args[invocation.args.indexOf('--mcp-config') + 1];
    assert.equal(JSON.parse(readFileSync(mcpPath, 'utf8')).mcpServers.local.env.TOKEN, 'secret');
  } finally { delete process.env.HANDOFF_TEST_MCP; rmSync(temp, { recursive: true, force: true }); }
});
