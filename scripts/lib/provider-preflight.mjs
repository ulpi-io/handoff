import { spawnSync } from 'node:child_process';

const PROBE_LIMIT = 1024 * 1024;

function boundedLine(value) {
  return String(value || '').split(/\r?\n/u).map((line) => line.trim()).find(Boolean)?.slice(0, 512) || null;
}

export function flagPreflight(bin, { versionArgs = ['--version'], helpArgs, requiredFlags }) {
  if (!bin) return { ok: false, version: null, reason: 'provider executable not found' };
  const options = {
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: PROBE_LIMIT,
    env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' },
  };
  const versionProbe = spawnSync(bin, versionArgs, options);
  if (versionProbe.error || versionProbe.status !== 0) {
    return { ok: false, version: null, reason: `version probe failed: ${versionProbe.error?.message || `exit ${versionProbe.status ?? 1}`}` };
  }
  const version = boundedLine(versionProbe.stdout) || boundedLine(versionProbe.stderr);
  if (!version) return { ok: false, version: null, reason: 'version probe returned no version' };

  const helpProbe = spawnSync(bin, helpArgs, options);
  if (helpProbe.error || helpProbe.status !== 0) {
    return { ok: false, version, reason: `capability probe failed: ${helpProbe.error?.message || `exit ${helpProbe.status ?? 1}`}` };
  }
  const help = `${helpProbe.stdout || ''}\n${helpProbe.stderr || ''}`;
  const missing = requiredFlags.filter((flag) => !help.includes(flag));
  if (missing.length) return { ok: false, version, reason: `installed CLI lacks required flag(s): ${missing.join(', ')}` };
  return { ok: true, version, reason: null };
}
