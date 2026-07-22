import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMachineRequest } from './lib/contracts.mjs';
import { resolveBudgets, resolveSelection, validateOperation } from './lib/selection.mjs';

test('selection defaults and provenance are pinned per operation and harness', () => {
  assert.deepEqual(resolveSelection({ operation: 'advice', targetHarness: 'claude' }), {
    requested: { model: null, effort: null, maxTurns: null },
    resolved: { model: 'provider-default', effort: 'max', maxTurns: 32 },
    provenance: { model: 'provider-default', effort: 'operation-default', maxTurns: 'operation-default' },
  });
  assert.equal(resolveSelection({ operation: 'handoff', targetHarness: 'grok' }).resolved.maxTurns, 12);
  assert.equal(resolveSelection({ operation: 'advice', targetHarness: 'cursor' }).resolved.effort, 'provider-default');
  assert.throws(() => resolveSelection({ operation: 'advice', targetHarness: 'cursor', effort: 'high' }), /unsupported/);
  assert.throws(() => resolveSelection({ operation: 'advice', targetHarness: 'grok', maxTurns: 101 }), /1 through 100/);
});

test('caller and operation combinations fail closed', () => {
  assert.doesNotThrow(() => validateOperation({ operation: 'advice', callerHarness: 'kiro', targetHarness: 'codex', mode: null }));
  assert.throws(() => validateOperation({ operation: 'handoff', callerHarness: 'grok', targetHarness: 'codex', mode: 'build' }), /codex\|claude/);
  assert.throws(() => validateOperation({ operation: 'advice', callerHarness: 'codex', targetHarness: 'claude', mode: 'review' }), /does not accept/);
  assert.deepEqual(resolveBudgets(), { maxDepth: 3, maxNodes: 16, maxAdviceNodes: 12, maxHandoffNodes: 4, maxConcurrency: 4, rootTimeoutMs: 1800000, timeoutMs: 600000 });
});

test('v0.2 request parsing remains exact and rejects mixed versions', () => {
  const legacy = Buffer.from('{"schemaVersion":"handoff.request.v0.2","instructions":"review"}\n');
  assert.deepEqual(parseMachineRequest(legacy), { schemaVersion: 'handoff.request.v0.2', instructions: 'review' });
  assert.throws(() => parseMachineRequest(Buffer.from('{"schemaVersion":"handoff.request.v0.2","instructions":"review","operation":"advice"}')), /unknown field/);
});
