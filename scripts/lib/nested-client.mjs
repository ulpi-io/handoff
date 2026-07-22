import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';

import { ContractError, decodeUtf8, parseMachineResultV03, sha256 } from './contracts.mjs';
import { closeReservedResult, reserveResultPath, safeCwd, safeRequestPath, writeReservedResult } from './paths.mjs';

const MAX_REPLY_BYTES = 2_500_000;

function contextFromEnvironment(raw = process.env.HANDOFF_SUPERVISOR_CONTEXT) {
  if (!raw || Buffer.byteLength(raw) > 16_384) throw new ContractError('HANDOFF_SUPERVISOR_CONTEXT is missing or oversized');
  let value;
  try { value = JSON.parse(raw); } catch { throw new ContractError('HANDOFF_SUPERVISOR_CONTEXT is malformed'); }
  const keys = ['schemaVersion', 'endpoint', 'token', 'callerHarness', 'rootRunId'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(value, key))) throw new ContractError('HANDOFF_SUPERVISOR_CONTEXT has unknown or missing fields');
  if (value.schemaVersion !== 'handoff.supervisor-context.v0.3') throw new ContractError('HANDOFF_SUPERVISOR_CONTEXT version drift');
  for (const key of ['endpoint', 'token', 'callerHarness', 'rootRunId']) if (typeof value[key] !== 'string' || !value[key]) throw new ContractError(`HANDOFF_SUPERVISOR_CONTEXT.${key} is invalid`);
  return value;
}

function readInstructions(path) {
  const canonical = safeRequestPath(path);
  const bytes = readFileSync(canonical);
  if (bytes.length > 2_000_000) throw new ContractError('instructions file exceeds 2000000 bytes');
  return decodeUtf8(bytes, 'instructions file');
}

function readMcp(path) {
  if (!path) return null;
  const canonical = safeRequestPath(path);
  const bytes = readFileSync(canonical);
  if (bytes.length > 256_000) throw new ContractError('MCP descriptor exceeds 256000 bytes');
  return bytes.toString('base64');
}

async function exchange(endpoint, message) {
  return new Promise((resolve, reject) => {
    let connection = endpoint;
    if (endpoint.startsWith('tcp://')) {
      let url;
      try { url = new URL(endpoint); } catch { throw new ContractError('supervisor TCP endpoint is malformed'); }
      if (url.hostname !== '127.0.0.1' || !url.port || !['', '/'].includes(url.pathname)) throw new ContractError('supervisor TCP endpoint must be loopback-only');
      connection = { host: '127.0.0.1', port: Number(url.port) };
    }
    const socket = createConnection(connection);
    let bytes = Buffer.alloc(0);
    let settled = false;
    const fail = (error) => { if (!settled) { settled = true; socket.destroy(); reject(error); } };
    socket.once('error', (error) => fail(new ContractError(`supervisor connection failed: ${error.message}`)));
    socket.once('connect', () => socket.write(`${JSON.stringify(message)}\n`));
    socket.on('data', (chunk) => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length > MAX_REPLY_BYTES) { fail(new ContractError('supervisor reply exceeds limit')); return; }
      const newline = bytes.indexOf(10);
      if (newline === -1) return;
      if (bytes.subarray(newline + 1).length) { fail(new ContractError('supervisor sent more than one frame')); return; }
      settled = true;
      socket.end();
      try { resolve(JSON.parse(bytes.subarray(0, newline).toString('utf8'))); }
      catch { reject(new ContractError('supervisor reply is malformed')); }
    });
    socket.once('end', () => { if (!settled) fail(new ContractError('supervisor closed without a terminal reply')); });
  });
}

export async function executeNestedRequest(options, { contextRaw } = {}) {
  if (options.callerHarness !== undefined) throw new ContractError('nested requests must not supply --caller-harness');
  if (options.limits && Object.keys(options.limits).length) throw new ContractError('nested requests must not supply root budget flags');
  const context = contextFromEnvironment(contextRaw);
  if (options.operation === 'handoff' && !['codex', 'claude'].includes(context.callerHarness)) throw new ContractError('derived caller cannot launch a handoff');
  const reservation = reserveResultPath(options.result);
  try {
    const message = {
      schemaVersion: 'handoff.supervisor-request.v0.3',
      token: context.token,
      nonce: randomUUID(),
      operation: options.operation,
      targetHarness: options.targetHarness,
      mode: options.mode ?? null,
      cwd: safeCwd(options.cwd),
      instructions: readInstructions(options.instructionsPath),
      selection: { model: options.model, effort: options.effort, maxTurns: options.maxTurns },
      grants: { bash: options.bash, webSearch: options.webSearch },
      mcp: readMcp(options.mcpConfig),
      dependencies: options.dependencies ?? [],
    };
    const reply = await exchange(context.endpoint, message);
    if (!reply || reply.schemaVersion !== 'handoff.supervisor-reply.v0.3' || typeof reply.ok !== 'boolean') throw new ContractError('supervisor reply contract drift');
    if (!reply.ok) throw new ContractError(`supervisor rejected nested request: ${reply.error || 'unknown error'}`);
    if (!Number.isInteger(reply.exitCode) || typeof reply.result !== 'string' || typeof reply.resultHash !== 'string') throw new ContractError('supervisor terminal reply is incomplete');
    const bytes = Buffer.from(reply.result, 'base64');
    if (sha256(bytes) !== reply.resultHash) throw new ContractError('supervisor reply result hash mismatch');
    parseMachineResultV03(bytes);
    writeReservedResult(reservation, bytes);
    return { bytes, result: JSON.parse(bytes.toString('utf8')), exitCode: reply.exitCode };
  } catch (error) {
    closeReservedResult(reservation);
    try { rmSync(reservation.path, { force: true }); } catch { /* exact reserved path only */ }
    throw error;
  }
}

export function hasSupervisorContext(environment = process.env) {
  return typeof environment.HANDOFF_SUPERVISOR_CONTEXT === 'string' && environment.HANDOFF_SUPERVISOR_CONTEXT.length > 0;
}
