// prompt.mjs — the injection-safe boundary. The handoff brief is ALWAYS material that the model
// wrote to a file (via the Write tool); this module only reads/validates it and hands the bytes to
// the driver. The prompt is never interpolated into a shell string or an argv element — providers
// receive it either on stdin or as a --prompt-file PATH (the path is safe; the bytes stay in the file).
import { readFileSync, existsSync, statSync } from 'node:fs';
import { locateExecutable } from './which.mjs';

export function readPromptFile(path) {
  if (!path) throw new HandoffError('no --prompt-file given (the brief must be written to a file first)');
  if (!existsSync(path)) throw new HandoffError(`--prompt-file '${path}' does not exist`);
  const text = readFileSync(path, 'utf8');
  if (!text.trim()) throw new HandoffError(`--prompt-file '${path}' is empty — nothing to hand off`);
  if (statSync(path).size > 2_000_000) throw new HandoffError(`--prompt-file '${path}' is >2MB — refuse to hand off (scope it down)`);
  return text;
}

// A typed error the driver turns into an honest nonRun/refusal, never a fabricated result.
export class HandoffError extends Error {}

export { locateExecutable };
