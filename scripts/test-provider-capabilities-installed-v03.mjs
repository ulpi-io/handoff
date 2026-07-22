import test from 'node:test';
import assert from 'node:assert/strict';
import * as claude from './lib/providers/claude.mjs';
import * as codex from './lib/providers/codex.mjs';
import * as cursor from './lib/providers/cursor.mjs';
import * as grok from './lib/providers/grok.mjs';
import * as kiro from './lib/providers/kiro.mjs';
import * as opencode from './lib/providers/opencode.mjs';

const adapters = { claude, codex, cursor, grok, kiro, opencode };

for (const [name, adapter] of Object.entries(adapters)) {
  test(`installed ${name} capability probe is authentication-free and fail-closed`, { skip: !adapter.locate() && `${name} is not installed` }, () => {
    for (const role of adapter.pipelineRoles) {
      const result = adapter.pipelinePreflight(adapter.locate(), { cwd: process.cwd(), role });
      assert.equal(typeof result.ok, 'boolean');
      if (!result.ok) assert.equal(typeof result.reason === 'string' && result.reason.length > 0, true, `${name}/${role} must explain a fail-closed capability`);
    }
    if (name === 'kiro' || name === 'opencode') {
      assert.equal(adapter.pipelinePolicy('review').nativeFilesystemIsolation ?? false, false);
    }
  });
}
