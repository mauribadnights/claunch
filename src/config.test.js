import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadConfig, saveConfig, DEFAULT_DEFAULTS } from './config.js';

let tmpDir;
let orig;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'claunch-config-test-'));
  orig = process.env.CLAUNCH_CONFIG_DIR;
  process.env.CLAUNCH_CONFIG_DIR = tmpDir;
});

afterEach(() => {
  if (orig === undefined) delete process.env.CLAUNCH_CONFIG_DIR;
  else process.env.CLAUNCH_CONFIG_DIR = orig;
  rmSync(tmpDir, { recursive: true, force: true });
});

test('loadConfig returns DEFAULT_DEFAULTS when no config file exists', () => {
  const cfg = loadConfig();
  assert.deepEqual(cfg.defaults.claude_flags, DEFAULT_DEFAULTS.claude_flags);
  assert.deepEqual(cfg.defaults.codex_flags, DEFAULT_DEFAULTS.codex_flags);
  assert.deepEqual(cfg.defaults.pi_flags, DEFAULT_DEFAULTS.pi_flags);
  assert.deepEqual(cfg.projects, {});
  assert.deepEqual(cfg.harnesses, {});
});

test('loadConfig backward compat: v0.4 config (no codex_flags / pi_flags / harnesses) gets defaults filled in', () => {
  const yaml = `defaults:
  claude_flags:
    - --dangerously-skip-permissions
projects:
  driffusion:
    dir: /tmp/driffusion
`;
  writeFileSync(join(tmpDir, 'config.yaml'), yaml, 'utf8');
  const cfg = loadConfig();
  assert.deepEqual(cfg.defaults.claude_flags, ['--dangerously-skip-permissions']);
  assert.deepEqual(cfg.defaults.codex_flags, DEFAULT_DEFAULTS.codex_flags);
  assert.deepEqual(cfg.defaults.pi_flags, DEFAULT_DEFAULTS.pi_flags);
  assert.equal(cfg.projects.driffusion.dir, '/tmp/driffusion');
  assert.deepEqual(cfg.harnesses, {});
});

test('loadConfig: user-set codex_flags override DEFAULT_DEFAULTS', () => {
  const yaml = `defaults:
  codex_flags:
    - --custom-flag
projects: {}
`;
  writeFileSync(join(tmpDir, 'config.yaml'), yaml, 'utf8');
  const cfg = loadConfig();
  assert.deepEqual(cfg.defaults.codex_flags, ['--custom-flag']);
  // Other harness defaults still applied
  assert.deepEqual(cfg.defaults.claude_flags, DEFAULT_DEFAULTS.claude_flags);
});

test('saveConfig + loadConfig round-trip preserves harnesses block', () => {
  saveConfig({
    defaults: { claude_flags: [], codex_flags: [], pi_flags: [] },
    scan_roots: [],
    projects: {},
    harnesses: {
      claude: { bin: 'claude', cli_signature_sha: 'abc123', last_audited: '2026-05-04' },
    },
  });
  const cfg = loadConfig();
  assert.equal(cfg.harnesses.claude.cli_signature_sha, 'abc123');
  assert.equal(cfg.harnesses.claude.last_audited, '2026-05-04');
});
