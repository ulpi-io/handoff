#!/usr/bin/env node
// Hermetic fake for the real pipeline subprocess boundary. Tests copy this file to a temporary
// PATH as codex, grok, or kiro-cli; it never reads provider/global configuration or uses network.
import { readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const args = process.argv.slice(2);
const executable = basename(process.argv[1]);

if (process.env.HANDOFF_FAKE_ANY_INVOKE_MARKER) {
  writeFileSync(process.env.HANDOFF_FAKE_ANY_INVOKE_MARKER, 'invoked\n');
}

function has(flag) { return args.includes(flag); }
function after(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

if (has('--version') || has('-V')) {
  process.stdout.write(`${executable} 99.0.0-fake\n`);
  process.exit(0);
}

if (has('--help') || has('-h')) {
  if (process.env.HANDOFF_FAKE_MODE === 'help-missing') {
    process.stdout.write('--sandbox\n');
    process.exit(0);
  }
  process.stdout.write([
    '--config --sandbox --cd --ephemeral --ignore-user-config --ignore-rules',
    '--output-schema --output-last-message',
    '--cwd --disable-web-search --json-schema --max-turns --no-memory --no-subagents',
    '--permission-mode --prompt-file --verbatim',
    '--no-interactive --trust-tools --wrap',
  ].join('\n') + '\n');
  process.exit(0);
}

async function stdinText() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

let prompt = '';
const promptFile = after('--prompt-file');
if (promptFile) prompt = readFileSync(promptFile, 'utf8');
else prompt = await stdinText();

const role = prompt.match(/machine role '([^']+)'/u)?.[1] || 'review';
const cwd = after('--cd') || after('--cwd') || process.cwd();
const mode = process.env.HANDOFF_FAKE_MODE || 'success';
let changedPath = null;

if ((role === 'build' || role === 'phase') && mode === 'success') {
  changedPath = `fake-${role}.txt`;
  writeFileSync(join(cwd, changedPath), `${role} change\n`);
}
if (mode === 'untracked') {
  changedPath = 'untracked only.txt';
  writeFileSync(join(cwd, changedPath), 'untracked\n');
}
if (mode === 'review-mutation') {
  changedPath = 'reviewer mutation.txt';
  writeFileSync(join(cwd, changedPath), 'mutation\n');
}
if (mode === 'symlink-change') {
  changedPath = 'unsafe-link';
  symlinkSync('../outside-target', join(cwd, changedPath));
}
if (mode === 'hang') {
  if (process.env.HANDOFF_FAKE_READY_FILE) writeFileSync(process.env.HANDOFF_FAKE_READY_FILE, 'ready\n');
  setInterval(() => {}, 60_000);
  await new Promise(() => {});
}

const output = {
  schemaVersion: 'handoff.provider-output.v0.2',
  status: mode === 'exit' ? 'failed' : 'completed',
  summary: mode === 'exit' ? 'fake provider failure' : `fake ${role} completed`,
  evidence: changedPath ? [{ kind: 'file-change', path: changedPath, summary: 'fake changed a file' }] : [],
  findings: [],
  usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
};

let serialized = JSON.stringify(output);
if (mode === 'noisy') serialized = `provider noise\n${serialized}`;
if (mode === 'prose') serialized = 'Everything looks good.';
if (mode === 'oversized') serialized = JSON.stringify({ ...output, summary: 'x'.repeat(300_000) });
if (mode === 'schema-drift') serialized = JSON.stringify({ ...output, schemaVersion: 'handoff.provider-output.v9' });
if (mode === 'unknown-field') serialized = JSON.stringify({ ...output, surprise: true });
if (mode === 'unsafe-evidence-path') serialized = JSON.stringify({
  ...output,
  evidence: [{ kind: 'file-change', path: '../escape', summary: 'unsafe' }],
});

if (mode === 'stderr-secret') {
  process.stderr.write('api_key=super-secret-value Bearer abcdefghijklmnopqrstuvwxyz\n');
}

const resultFile = after('--output-last-message');
if (mode !== 'missing') {
  if (resultFile) writeFileSync(resultFile, serialized);
  else process.stdout.write(serialized);
}

process.exit(mode === 'exit' ? Number(process.env.HANDOFF_FAKE_EXIT || 23) : 0);
