import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeFrontend, parseFrontendCli } from './lib/frontend.mjs';

const cwd = process.cwd();
const instructions = new URL('../README.md', import.meta.url).pathname;

function command(result) {
  return ['advice', '--caller-harness', 'grok', '--harness', 'claude', '--cwd', cwd, '--instructions', instructions, '--result', result, '--model', 'fable', '--effort', 'max', '--max-turns', '32', '--bash', 'true', '--web-search', 'true'];
}

test('frontend parses exact root and nested forms without shorthands', () => {
  const parsed = parseFrontendCli(command('/tmp/result.json'), { nested: false });
  assert.equal(parsed.options.callerHarness, 'grok');
  assert.equal(parsed.options.targetHarness, 'claude');
  assert.equal(parsed.options.maxTurns, 32);
  assert.throws(() => parseFrontendCli(['run', '--caller-harness', 'grok', '--harness', 'claude', '--mode', 'build', '--cwd', cwd, '--instructions', instructions, '--result', '/tmp/r'], { nested: false }), /codex\|claude/);
  assert.throws(() => parseFrontendCli([...command('/tmp/r'), '--model', 'other'], { nested: false }), /duplicate/);
  assert.throws(() => parseFrontendCli(command('/tmp/r'), { nested: true }), /must not supply/);
});

test('frontend routes root execution once and emits byte-identical result bytes', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'handoff-frontend-test-'));
  const resultPath = join(temp, 'result.json');
  let executions = 0;
  class Supervisor {
    constructor({ rootPrepared }) {
      this.rootPrepared = rootPrepared;
      const node = { state: 'running' };
      this.runtime = { store: {
        nodes: new Map([[rootPrepared.request.lineage.runId, node]]),
        snapshot: () => null,
        terminalize: () => { node.state = 'succeeded'; },
      } };
    }
    async start() {}
    contextForRoot() { return '{"fake":true}'; }
    async close() {}
  }
  try {
    const execution = await executeFrontend(command(resultPath), {
      nested: false,
      Supervisor,
      executeMachineRun: async (options) => {
        executions += 1;
        const result = { status: 'succeeded', output: { response: 'answer' } };
        const bytes = Buffer.from(`${JSON.stringify(result)}\n`);
        writeFileSync(options.result, bytes, { mode: 0o600, flag: 'wx' });
        return { result, exitCode: 0 };
      },
    });
    assert.equal(executions, 1);
    assert.deepEqual(execution.bytes, readFileSync(resultPath));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('capabilities version routing preserves v0.2 and exposes v0.3 explicitly', async () => {
  const legacy = await executeFrontend(['capabilities', '--json'], { nested: false, machineCapabilities: () => ({ schemaVersion: 'handoff.capabilities.v0.2' }) });
  const current = await executeFrontend(['capabilities', '--json', '--version', 'v0.3'], { nested: false, machineCapabilitiesV03: () => ({ schemaVersion: 'handoff.capabilities.v0.3' }) });
  assert.equal(legacy.result.schemaVersion, 'handoff.capabilities.v0.2');
  assert.equal(current.result.schemaVersion, 'handoff.capabilities.v0.3');
});
