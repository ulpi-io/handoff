#!/usr/bin/env node
// Strict slash-command frontend: turn literal instruction-file bytes into the versioned request
// consumed by handoff.mjs. For Codex, invoking this helper is the coordinator's explicit approval
// to bind every applicable repository AGENTS.md rule into the request.
import { rmSync } from 'node:fs';
import { prepareLegacyRequest } from './lib/request-preparer.mjs';
import {
  closeReservedResult,
  reserveResultPath,
  writeReservedResult,
} from './lib/paths.mjs';

function parseArgs(argv) {
  const result = {};
  const allowed = new Set(['--provider', '--role', '--cwd', '--instructions', '--request', '--timeout-ms', '--max-turns', '--web-search', '--model', '--effort']);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!allowed.has(flag)) throw new Error(`unknown argument: ${flag}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    const key = flag.slice(2).replaceAll('-', '_');
    if (Object.hasOwn(result, key)) throw new Error(`duplicate argument: ${flag}`);
    result[key] = value;
  }
  const missing = ['provider', 'role', 'cwd', 'instructions', 'request'].filter((key) => !result[key]);
  if (missing.length) throw new Error(`missing argument(s): ${missing.map((key) => `--${key}`).join(', ')}`);
  return result;
}

function prepare(options) {
  if (options.web_search !== undefined && !['true', 'false'].includes(options.web_search)) {
    throw new Error('--web-search must be true|false');
  }
  const reservation = reserveResultPath(options.request);
  try {
    const prepared = prepareLegacyRequest({
      provider: options.provider,
      role: options.role,
      cwd: options.cwd,
      instructionsPath: options.instructions,
      timeoutMs: options.timeout_ms === undefined ? undefined : Number(options.timeout_ms),
      maxTurns: options.max_turns === undefined ? undefined : Number(options.max_turns),
      webSearch: options.web_search === undefined ? undefined : options.web_search === 'true',
      model: options.model,
      effort: options.effort,
    });
    writeReservedResult(reservation, prepared.bytes);
    return {
      schemaVersion: 'handoff.prepared-request.v0.3',
      status: 'prepared',
      provider: options.provider,
      role: options.role,
      request: reservation.path,
      requestHash: prepared.requestHash,
      coordinatorApproval: options.provider === 'codex' ? 'repository-rules-bound' : 'not-required',
    };
  } catch (error) {
    closeReservedResult(reservation);
    try { rmSync(reservation.path, { force: true }); } catch { /* exact reserved path only */ }
    throw error;
  }
}

try {
  process.stdout.write(`${JSON.stringify(prepare(parseArgs(process.argv.slice(2))))}\n`);
} catch (error) {
  process.stderr.write(`handoff request rejected: ${error.message}\n`);
  process.exitCode = 5;
}
