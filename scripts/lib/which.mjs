// which.mjs — locate a provider binary on PATH (and a couple of well-known install dirs the
// vendors use), WITHOUT running a shell. A missing binary is the first fail-closed gate: the driver
// reports it and exits nonzero with an install hint — it NEVER attempts to auto-install anything.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function locateExecutable(name, extraDirs = []) {
  const pathDirs = (process.env.PATH || '').split(':').filter(Boolean);
  const home = homedir();
  const dirs = [...pathDirs, ...extraDirs.map((d) => d.replace('~', home))];
  for (const dir of dirs) {
    const p = join(dir, name);
    try { if (existsSync(p)) return p; } catch { /* ignore */ }
  }
  return null;
}
