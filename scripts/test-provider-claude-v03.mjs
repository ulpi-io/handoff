import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipelineExtractResult, pipelineInvocation, pipelineOutputSchema } from './lib/providers/claude.mjs';

test('Claude removes unsupported schema registry metadata without changing the contract body', () => {
  const source = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'https://example.test/schema', type: 'object', properties: { answer: { type: 'string' } } };
  const compatible = pipelineOutputSchema(source);
  assert.equal('$schema' in compatible, false);
  assert.equal('$id' in compatible, false);
  assert.deepEqual(compatible.properties, source.properties);
  assert.equal(source.$schema, 'https://json-schema.org/draft/2020-12/schema');
});

test('Claude preserves bounded error-envelope diagnostics', () => {
  assert.throws(
    () => pipelineExtractResult(Buffer.from(JSON.stringify({ is_error: true, result: 'schema keyword unsupported' }))),
    /schema keyword unsupported/u,
  );
});

test('Claude maps sandboxed Bash, web tools, turns, and strict private MCP', () => {
  const temp = mkdtempSync(join(tmpdir(), 'handoff-claude-test-'));
  process.env.HANDOFF_TEST_MCP = 'secret';
  try {
    const invocation = pipelineInvocation({ bin: '/bin/claude', role: 'review', cwd: process.cwd(), tempRoot: temp, schemaJson: '{}', model: 'fable', effort: 'max', maxTurns: 32, bash: true, webSearch: true, mcpDescriptor: { servers: [{ name: 'local', transport: 'stdio', command: '/usr/bin/env', args: [], env: { TOKEN: { fromEnv: 'HANDOFF_TEST_MCP' } } }] } });
    assert.equal(invocation.policy.nativeBashSandbox, true);
    assert.equal(invocation.policy.nativeFilesystemIsolation, false);
    assert.equal(invocation.policy.toolAllowlist.includes('WebSearch'), true);
    assert.equal(invocation.policy.toolAllowlist.includes('Bash'), true);
    assert.equal(invocation.args.includes('--safe-mode'), true);
    assert.equal(invocation.args.includes('--bare'), false);
    assert.match(invocation.policy.userConfiguration, /authentication retained/u);
    const mcpPath = invocation.args[invocation.args.indexOf('--mcp-config') + 1];
    assert.equal(JSON.parse(readFileSync(mcpPath, 'utf8')).mcpServers.local.env.TOKEN, 'secret');
  } finally { delete process.env.HANDOFF_TEST_MCP; rmSync(temp, { recursive: true, force: true }); }
});
