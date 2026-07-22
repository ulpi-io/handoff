import test from 'node:test';
import assert from 'node:assert/strict';
import { pipelineInvocation, pipelinePolicy } from './lib/providers/kiro.mjs';

test('Kiro maps permission-only build tools and native selection without trust-all', () => {
  const invocation = pipelineInvocation({ bin: '/bin/kiro-cli', role: 'build', model: 'kiro-model', effort: 'max', bash: true });
  assert.equal(invocation.args.includes('--trust-tools=fs_read,fs_write,execute_bash'), true);
  assert.equal(invocation.args.includes('--trust-all-tools'), false);
  assert.equal(invocation.policy.nativeFilesystemIsolation, false);
  assert.equal(invocation.policy.mutationGuarantee, 'final-state-detection-only');
  assert.throws(() => pipelineInvocation({ bin: '/bin/kiro-cli', role: 'review', bash: true, mcpDescriptor: { servers: [] } }), /not proved/);
  assert.deepEqual(pipelinePolicy('review').toolAllowlist, ['read', 'grep', 'glob']);
});
