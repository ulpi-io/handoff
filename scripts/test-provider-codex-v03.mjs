import test from 'node:test';
import assert from 'node:assert/strict';
import { pipelineInvocation } from './lib/providers/codex.mjs';

test('Codex maps model, effort, sandbox, and private MCP without secret argv values', () => {
  process.env.HANDOFF_TEST_MCP = 'secret-not-on-argv';
  try {
    const invocation = pipelineInvocation({
      bin: '/bin/codex', role: 'review', cwd: process.cwd(), model: 'gpt-5.6-sol', effort: 'max', schemaFile: '/tmp/schema', lastMsgFile: '/tmp/result',
      coordinatorApproval: { approvalId: 'id', issuer: 'test', scope: 'all-applicable-agents-rules', subjectHash: `sha256:${'0'.repeat(64)}`, rulesDigest: `sha256:${'1'.repeat(64)}`, rules: [] },
      mcpDescriptor: { servers: [{ name: 'local', transport: 'stdio', command: '/usr/bin/env', args: [], env: { TOKEN: { fromEnv: 'HANDOFF_TEST_MCP' } } }] },
    });
    assert.equal(invocation.args.includes('read-only'), true);
    assert.equal(invocation.args.includes('gpt-5.6-sol'), true);
    assert.equal(invocation.args.some((arg) => arg.includes('model_reasoning_effort="max"')), true);
    assert.equal(invocation.args.some((arg) => arg.includes('secret-not-on-argv')), false);
    assert.equal(invocation.env.TOKEN, 'secret-not-on-argv');
  } finally { delete process.env.HANDOFF_TEST_MCP; }
});
