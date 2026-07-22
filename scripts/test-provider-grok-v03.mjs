import test from 'node:test';
import assert from 'node:assert/strict';
import { pipelineInvocation } from './lib/providers/grok.mjs';

test('Grok maps advice turns, effort, Bash, web, and named read-only sandbox', () => {
  const invocation = pipelineInvocation({ bin: '/bin/grok', role: 'review', cwd: process.cwd(), promptFile: '/tmp/prompt', schemaJson: '{}', model: 'grok-code-fast', effort: 'high', maxTurns: 32, bash: true, webSearch: true });
  assert.equal(invocation.policy.sandboxProfile, 'read-only');
  assert.equal(invocation.policy.maxTurns, 32);
  assert.equal(invocation.policy.toolAllowlist.includes('Bash'), true);
  assert.equal(invocation.policy.toolAllowlist.includes('WebSearch'), true);
  assert.equal(invocation.args.includes('--disable-web-search'), false);
  assert.equal(invocation.args.includes('32'), true);
});
