import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMcpDescriptor, parseProviderOutput } from './lib/contracts.mjs';

test('v0.3 provider output requires one non-empty response', () => {
  const value = { schemaVersion: 'handoff.provider-output.v0.3', status: 'completed', response: 'Use the bounded supervisor.', evidence: [], findings: [], usage: {} };
  assert.deepEqual(parseProviderOutput(Buffer.from(JSON.stringify(value))), value);
  assert.throws(() => parseProviderOutput(Buffer.from(JSON.stringify({ ...value, response: '' }))), /must not be empty/);
  assert.throws(() => parseProviderOutput(Buffer.from(JSON.stringify({ ...value, secret: 'x' }))), /unknown field/);
});

test('MCP descriptors contain references, not literal secret fields', () => {
  const descriptor = {
    schemaVersion: 'handoff.mcp.v0.3',
    servers: [
      { name: 'local', transport: 'stdio', command: '/usr/bin/env', args: ['node', 'server.mjs'], env: { TOKEN: { fromEnv: 'MCP_TOKEN' } } },
      { name: 'remote', transport: 'http', url: 'https://mcp.example.test/rpc', headers: { Authorization: { fromEnv: 'MCP_AUTH' } } },
    ],
  };
  assert.equal(parseMcpDescriptor(Buffer.from(JSON.stringify(descriptor))).servers.length, 2);
  assert.throws(() => parseMcpDescriptor(Buffer.from(JSON.stringify({ ...descriptor, secret: 'literal' }))), /unknown field/);
  assert.throws(() => parseMcpDescriptor(Buffer.from(JSON.stringify({ schemaVersion: 'handoff.mcp.v0.3', servers: [{ ...descriptor.servers[0], command: 'node' }] }))), /must be absolute/);
  assert.throws(() => parseMcpDescriptor(Buffer.from(JSON.stringify({ schemaVersion: 'handoff.mcp.v0.3', servers: [{ ...descriptor.servers[1], url: 'http://insecure.test' }] }))), /credential-free HTTPS/);
});
