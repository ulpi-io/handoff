import test from 'node:test';
import assert from 'node:assert/strict';
import { pipelineExtractResult, pipelineInvocation, pipelineOutputSchema } from './lib/providers/codex.mjs';

test('Codex receives a strict required-but-nullable output schema and nulls normalize away', () => {
  const source = {
    type: 'object', additionalProperties: false, required: ['items'],
    properties: { items: { type: 'array', items: { $ref: '#/$defs/item' } } },
    $defs: { item: { type: 'object', additionalProperties: false, required: ['summary'], properties: { summary: { type: 'string' }, path: { type: 'string' } } } },
  };
  const compatible = pipelineOutputSchema(source);
  assert.deepEqual(compatible.$defs.item.required, ['summary', 'path']);
  assert.deepEqual(compatible.$defs.item.properties.path.type, ['string', 'null']);
  assert.deepEqual(source.$defs.item.required, ['summary']);

  const typed = pipelineOutputSchema({ type: 'object', properties: { version: { const: 'v1' }, state: { enum: ['ok', 'failed'] } }, required: ['version', 'state'] });
  assert.equal(typed.properties.version.type, 'string');
  assert.equal(typed.properties.state.type, 'string');

  const extracted = pipelineExtractResult(Buffer.from(JSON.stringify({
    evidence: [{ kind: 'test', path: null, summary: 'ok' }],
    findings: [{ file: null, line: null, severity: 'low', summary: 'none' }],
    usage: { inputTokens: null, outputTokens: 2, totalTokens: null },
  })));
  assert.deepEqual(JSON.parse(extracted.bytes), {
    evidence: [{ kind: 'test', summary: 'ok' }],
    findings: [{ severity: 'low', summary: 'none' }],
    usage: { outputTokens: 2 },
  });
});

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
