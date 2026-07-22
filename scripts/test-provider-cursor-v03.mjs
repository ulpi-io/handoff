import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipelineInvocation } from './lib/providers/cursor.mjs';

test('Cursor maps model, read-only target sandbox, temporary HOME, and approved MCP only', () => {
  const temp = mkdtempSync(join(tmpdir(), 'handoff-cursor-test-'));
  try {
    const invocation = pipelineInvocation({ bin: '/bin/cursor-agent', role: 'review', cwd: process.cwd(), tempRoot: temp, model: 'cursor-model', mcpDescriptor: { servers: [{ name: 'remote', transport: 'http', url: 'https://mcp.example.test', headers: {} }] } });
    assert.equal(invocation.args.includes('--readonly-paths'), true);
    assert.equal(invocation.args.includes('--approve-mcps'), true);
    assert.equal(invocation.args.includes('--force'), false);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(invocation.env.HOME, '.cursor', 'mcp.json'), 'utf8')).mcpServers), ['remote']);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
