import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseFrontendCli } from './lib/frontend.mjs';
import { executeMachineRun, machineCapabilitiesV03 } from './lib/machine.mjs';
import { executeNestedRequest } from './lib/nested-client.mjs';
import { prepareV03Request } from './lib/request-preparer.mjs';
import { HandoffSupervisor } from './lib/supervisor.mjs';
import { cleanupV03, invokeV03, setupV03 } from './test-v03-e2e-helpers.mjs';

const HARNESSES = ['codex', 'grok', 'kiro', 'claude', 'opencode', 'cursor'];

async function waitFor(path, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`timed out waiting for ${path}`);
}

function preparedRoot(context, overrides = {}) {
  return prepareV03Request({
    operation: 'advice', callerHarness: 'grok', targetHarness: 'claude', cwd: context.repo,
    instructionsPath: context.instructions, tempRoot: context.root, ...overrides,
  });
}

async function withFakeProviders(context, callback) {
  const priorPath = process.env.PATH;
  const priorMode = process.env.HANDOFF_FAKE_MODE;
  const priorReady = process.env.HANDOFF_FAKE_READY_FILE;
  process.env.PATH = `${context.bin}:${priorPath || ''}`;
  try { return await callback(); }
  finally {
    process.env.PATH = priorPath;
    if (priorMode === undefined) delete process.env.HANDOFF_FAKE_MODE; else process.env.HANDOFF_FAKE_MODE = priorMode;
    if (priorReady === undefined) delete process.env.HANDOFF_FAKE_READY_FILE; else process.env.HANDOFF_FAKE_READY_FILE = priorReady;
  }
}

test('read-only advice accepts every asserted caller and reaches every fake target', () => {
  for (const caller of HARNESSES) {
    for (const target of HARNESSES) {
      const context = setupV03();
      try {
        const { proc, parsed } = invokeV03(context, { caller, target, resultName: `${caller}-${target}.json` });
        assert.equal(proc.status, 0, `${caller}->${target}: ${proc.stderr}`);
        assert.equal(parsed.caller.harness, caller);
        assert.equal(parsed.caller.provenance, 'root-asserted');
        assert.equal(parsed.target.harness, target);
        assert.equal(parsed.operation, 'advice');
        assert.equal(parsed.grants.resolved.write, false);
        assert.match(parsed.output.response, /fake review completed/u);
      } finally { cleanupV03(context); }
    }
  }
});

test('supervisor derives nested callers, persists typed lineage, attenuates grants, and enforces node budgets', async () => {
  const context = setupV03();
  let supervisor;
  try {
    await withFakeProviders(context, async () => {
      const root = preparedRoot(context, { limits: { maxDepth: 2, maxNodes: 3, maxAdviceNodes: 3, maxHandoffNodes: 0, maxConcurrency: 3, rootTimeoutMs: 30_000, timeoutMs: 5_000 } });
      supervisor = new HandoffSupervisor({ rootPrepared: root, executeMachineRun, cleanup: false });
      await supervisor.start();
      const raw = supervisor.contextForRoot();
      const exposed = JSON.parse(raw);
      assert.deepEqual(Object.keys(exposed).sort(), ['callerHarness', 'endpoint', 'rootRunId', 'schemaVersion', 'token']);
      assert.doesNotMatch(raw, /dag\.json|handoff-supervisors/u);

      const firstPath = join(context.root, 'nested-first.json');
      const first = await executeNestedRequest({
        operation: 'advice', targetHarness: 'grok', cwd: context.repo, instructionsPath: context.instructions,
        result: firstPath, dependencies: [],
      }, { contextRaw: raw });
      assert.equal(first.exitCode, 0);
      assert.equal(first.result.caller.harness, 'claude');
      assert.equal(first.result.caller.provenance, 'supervisor-derived');
      assert.equal(first.result.lineage.parentRunId, root.request.lineage.runId);
      assert.deepEqual(first.bytes, readFileSync(firstPath));

      const secondInstructions = join(context.root, 'second-instructions.txt');
      writeFileSync(secondInstructions, 'Give different bounded advice about the verified child result.\n', { mode: 0o600 });
      const second = await executeNestedRequest({
        operation: 'advice', targetHarness: 'kiro', cwd: context.repo, instructionsPath: secondInstructions,
        result: join(context.root, 'nested-second.json'),
        dependencies: [{ type: 'requires', runId: first.result.lineage.runId }],
      }, { contextRaw: raw });
      assert.equal(second.exitCode, 0);
      assert.deepEqual(second.result.lineage.dependencies, [{ type: 'requires', runId: first.result.lineage.runId }]);

      await assert.rejects(() => executeNestedRequest({
        operation: 'advice', targetHarness: 'grok', cwd: context.repo, instructionsPath: secondInstructions,
        result: join(context.root, 'grant-escalation.json'), webSearch: true,
      }, { contextRaw: raw }), /cannot expand parent webSearch grant/u);
      const budgetContext = supervisor.contextForRoot();
      await assert.rejects(() => executeNestedRequest({
        operation: 'advice', targetHarness: 'opencode', cwd: context.repo, instructionsPath: secondInstructions,
        result: join(context.root, 'budget-exhausted.json'),
      }, { contextRaw: budgetContext }), /maxNodes budget is exhausted/u);

      const snapshot = supervisor.runtime.store.snapshot();
      assert.equal(snapshot.nodes.length, 3);
      assert.equal(snapshot.nodes.filter((node) => node.state === 'succeeded').length, 2);
      assert.equal(snapshot.remaining.nodes, 0);
    });
  } finally {
    if (supervisor) {
      const runtime = supervisor.runtime.directory;
      await supervisor.close('succeeded');
      rmSync(runtime, { recursive: true, force: true });
    }
    cleanupV03(context);
  }
});

test('derived Claude may hand off a write task while advice parents cannot expand into write', async () => {
  for (const rootOperation of ['advice', 'handoff']) {
    const context = setupV03();
    let supervisor;
    try {
      await withFakeProviders(context, async () => {
        const root = preparedRoot(context, rootOperation === 'handoff' ? {
          operation: 'handoff', callerHarness: 'codex', targetHarness: 'claude', mode: 'build',
        } : {});
        supervisor = new HandoffSupervisor({ rootPrepared: root, executeMachineRun, cleanup: false });
        await supervisor.start();
        const resultPath = join(context.root, `${rootOperation}-nested-handoff.json`);
        const request = executeNestedRequest({
          operation: 'handoff', targetHarness: 'grok', mode: 'build', cwd: context.repo,
          instructionsPath: context.instructions, result: resultPath,
        }, { contextRaw: supervisor.contextForRoot() });
        if (rootOperation === 'advice') {
          await assert.rejects(() => request, /cannot expand parent write grant/u);
          assert.equal(existsSync(resultPath), false);
        } else {
          const nested = await request;
          assert.equal(nested.exitCode, 0);
          assert.equal(nested.result.caller.harness, 'claude');
          assert.equal(nested.result.grants.resolved.write, true);
          assert.equal(nested.result.git.changed, true);
        }
      });
    } finally {
      if (supervisor) {
        const runtime = supervisor.runtime.directory;
        await supervisor.close('cancelled');
        rmSync(runtime, { recursive: true, force: true });
      }
      cleanupV03(context);
    }
  }
});

test('nested failure, timeout, concurrency, depth, replay, and cancellation stay terminal and bounded', async () => {
  const context = setupV03();
  let supervisor;
  try {
    await withFakeProviders(context, async () => {
      const root = preparedRoot(context, { limits: { maxDepth: 1, maxNodes: 4, maxAdviceNodes: 4, maxHandoffNodes: 0, maxConcurrency: 2, rootTimeoutMs: 5_000, timeoutMs: 1_000 } });
      supervisor = new HandoffSupervisor({ rootPrepared: root, executeMachineRun, cleanup: false });
      await supervisor.start();
      const raw = supervisor.contextForRoot();

      process.env.HANDOFF_FAKE_MODE = 'exit';
      const failed = await executeNestedRequest({
        operation: 'advice', targetHarness: 'grok', cwd: context.repo, instructionsPath: context.instructions,
        result: join(context.root, 'nested-failed.json'),
      }, { contextRaw: raw });
      assert.equal(failed.exitCode, 2);
      assert.equal(failed.result.status, 'failed');
      assert.equal(supervisor.runtime.store.nodes.get(failed.result.lineage.runId).state, 'failed');

      const different = join(context.root, 'hang-instructions.txt');
      writeFileSync(different, 'Give bounded advice after waiting for the concurrency probe.\n', { mode: 0o600 });
      const ready = join(context.root, 'provider-ready');
      process.env.HANDOFF_FAKE_MODE = 'hang';
      process.env.HANDOFF_FAKE_READY_FILE = ready;
      const hanging = executeNestedRequest({
        operation: 'advice', targetHarness: 'claude', cwd: context.repo, instructionsPath: different,
        result: join(context.root, 'nested-timeout.json'),
      }, { contextRaw: raw });
      await waitFor(ready);
      await assert.rejects(() => executeNestedRequest({
        operation: 'advice', targetHarness: 'opencode', cwd: context.repo, instructionsPath: different,
        result: join(context.root, 'nested-concurrency.json'), model: 'different-model',
      }, { contextRaw: raw }), /maxConcurrency budget is exhausted/u);
      const timed = await hanging;
      assert.equal(timed.exitCode, 8);
      assert.equal(timed.result.status, 'timed_out');
      assert.equal(supervisor.runtime.store.nodes.get(timed.result.lineage.runId).state, 'timed_out');

      const childContext = supervisor.childContext({ lineage: failed.result.lineage, target: failed.result.target, grants: failed.result.grants });
      await assert.rejects(() => executeNestedRequest({
        operation: 'advice', targetHarness: 'kiro', cwd: context.repo, instructionsPath: different,
        result: join(context.root, 'nested-depth.json'),
      }, { contextRaw: childContext }), /depth (?:is invalid or exhausted|exceeds maxDepth)/u);

      const replay = JSON.parse(raw);
      const frame = Buffer.from(JSON.stringify({
        schemaVersion: 'handoff.supervisor-request.v0.3', token: replay.token, nonce: 'fixed-replay', operation: 'advice',
        targetHarness: 'grok', mode: null, cwd: context.repo, instructions: 'A unique replay probe.', selection: {},
        grants: { bash: false, webSearch: false }, mcp: null, dependencies: [],
      }));
      process.env.HANDOFF_FAKE_MODE = 'success';
      await supervisor.handleFrame(frame);
      await assert.rejects(() => supervisor.handleFrame(frame), /replayed/u);
    });
  } finally {
    if (supervisor) {
      const runtime = supervisor.runtime.directory;
      const final = await supervisor.close('cancelled');
      assert.equal(final.status, 'cancelled');
      assert.equal(final.nodes.find((node) => node.parentRunId === null).state, 'cancelled');
      rmSync(runtime, { recursive: true, force: true });
    }
    cleanupV03(context);
  }
});

test('provider capability receipts do not overclaim isolation or unsupported controls', () => {
  const capabilities = machineCapabilitiesV03();
  const kiro = capabilities.providers.find((provider) => provider.id === 'kiro');
  const opencode = capabilities.providers.find((provider) => provider.id === 'opencode');
  const grok = capabilities.providers.find((provider) => provider.id === 'grok');
  const codex = capabilities.providers.find((provider) => provider.id === 'codex');
  assert.equal(kiro.isolation.nativeFilesystemIsolation, false);
  assert.equal(kiro.isolation.mutationGuarantee, 'final-state-detection-only');
  assert.equal(opencode.isolation.nativeFilesystemIsolation, false);
  assert.equal(grok.grants.mcp, false);
  assert.equal(codex.grants.webSearch, false);
  assert.throws(() => parseFrontendCli([
    'advice', '--harness', 'grok', '--cwd', process.cwd(), '--instructions', new URL('../README.md', import.meta.url).pathname,
    '--result', '/tmp/never.json', '--lineage', 'worker-authored',
  ], { nested: true }), /unknown argument/u);
});
