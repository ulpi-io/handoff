import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const scripts = dirname(fileURLToPath(import.meta.url));
export const DRIVER = resolve(scripts, 'handoff.mjs');
const FAKE = resolve(scripts, 'fixtures/fake-provider.mjs');

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

export function setupV03() {
  const root = mkdtempSync(join(tmpdir(), 'handoff-v03-e2e-'));
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  mkdirSync(repo);
  mkdirSync(bin);
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'fake@example.test']);
  git(repo, ['config', 'user.name', 'Fake Provider']);
  writeFileSync(join(repo, 'seed.txt'), 'seed\n');
  git(repo, ['add', 'seed.txt']);
  git(repo, ['commit', '-qm', 'seed']);
  for (const name of ['claude', 'codex', 'cursor-agent', 'grok', 'kiro-cli', 'opencode']) {
    copyFileSync(FAKE, join(bin, name));
    chmodSync(join(bin, name), 0o755);
  }
  const instructions = join(root, 'instructions.txt');
  writeFileSync(instructions, 'Perform the exact bounded fake task and return a direct answer.\n', { mode: 0o600 });
  return { root, repo, bin, instructions };
}

export function cleanupV03(context) {
  rmSync(context.root, { recursive: true, force: true });
}

export function invokeV03(context, {
  operation = 'advice', caller = 'grok', target = 'claude', mode = null, resultName = `${operation}-${target}.json`,
  extraArgs = [], fakeMode = 'success', extraEnv = {}, timeout = 20_000, driver = DRIVER,
} = {}) {
  const resultPath = join(context.root, resultName);
  const args = [driver, operation, '--caller-harness', caller, '--harness', target];
  if (mode) args.push('--mode', mode);
  args.push('--cwd', context.repo, '--instructions', context.instructions, '--result', resultPath, ...extraArgs);
  const proc = spawnSync(process.execPath, args, {
    cwd: context.repo,
    encoding: 'utf8',
    timeout,
    env: { ...process.env, PATH: `${context.bin}:${process.env.PATH || ''}`, HANDOFF_FAKE_MODE: fakeMode, ...extraEnv },
  });
  assert.equal(proc.signal, null, proc.stderr);
  assert.match(proc.stdout, /\S/u, `driver emitted no result (status=${proc.status}): ${proc.stderr}`);
  assert.equal(proc.stdout.trim().split('\n').length, 1, `stdout drift: ${proc.stdout}`);
  const parsed = JSON.parse(proc.stdout);
  if (readFileSync(resultPath, 'utf8') !== proc.stdout) assert.fail('stdout and result bytes differ');
  return { proc, parsed, resultPath };
}
