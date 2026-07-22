#!/usr/bin/env node
// Handoff is a strict machine driver. Slash commands prepare a versioned request and invoke this
// same entry point; there is no alternate provider/verb interface or weaker execution path.
import { fileURLToPath } from 'node:url';

import { executeFrontend } from './lib/frontend.mjs';
import { machineFailure } from './lib/machine.mjs';

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

function emitExecution(machine) {
  const diagnostics = [
    machine.result?.diagnostics?.message,
    machine.result?.diagnostics?.providerStderr,
  ].filter((value) => typeof value === 'string' && value.trim());
  if (diagnostics.length) process.stderr.write(`${diagnostics.join('\n')}\n`);
  process.stdout.write(machine.bytes);
  process.exitCode = machine.exitCode;
}

if (isMain) {
  try {
    emitExecution(await executeFrontend(process.argv.slice(2)));
  } catch (error) {
    const machine = machineFailure(error);
    emitExecution({ ...machine, bytes: Buffer.from(`${JSON.stringify(machine.result)}\n`) });
  }
}
