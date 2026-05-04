import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import YAML from 'yaml';

function getConfigDir() {
  return process.env.CLAUNCH_CONFIG_DIR || join(homedir(), '.claunch');
}

function getConfigPath() {
  return join(getConfigDir(), 'config.yaml');
}

function ensureConfigDir() {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Default config used for fresh installs and missing fields. The harness-flag
 * lists below match Mauricio's day-to-day defaults; users edit the YAML to
 * customize per machine.
 *
 * NOTE: An EXPLICITLY EMPTY user value (e.g. `codex_flags: []` in
 * config.yaml) is respected and overrides DEFAULT_DEFAULTS — the merge below
 * is shallow on purpose. If you want defaults restored, delete the key from
 * your config rather than setting it to `[]`. This is the intended behavior
 * but it IS a footgun: setting `codex_flags: []` makes Codex prompt for
 * approval on every action because `--dangerously-bypass-approvals-and-sandbox`
 * is no longer auto-injected.
 */
const DEFAULT_DEFAULTS = {
  claude_flags: ['--dangerously-skip-permissions'],
  codex_flags: ['--dangerously-bypass-approvals-and-sandbox', '--enable', 'goals'],
  pi_flags: [],
};

function loadConfig() {
  const path = getConfigPath();
  if (!existsSync(path)) {
    return {
      defaults: { ...DEFAULT_DEFAULTS },
      scan_roots: [],
      projects: {},
      harnesses: {},
    };
  }
  const raw = readFileSync(path, 'utf8');
  const config = YAML.parse(raw) || {};
  // Merge missing harness-flag keys against defaults (backward compat for
  // configs created before v0.5).
  const defaults = { ...DEFAULT_DEFAULTS, ...(config.defaults || {}) };
  return {
    defaults,
    scan_roots: config.scan_roots || [],
    projects: config.projects || {},
    harnesses: config.harnesses || {},
  };
}

function saveConfig(config) {
  ensureConfigDir();
  const path = getConfigPath();
  writeFileSync(path, YAML.stringify(config, { lineWidth: 120 }), 'utf8');
}

/** Expand ~ to homedir in a path string */
function expandHome(p) {
  if (!p) return p;
  if (p === '~' || p.startsWith('~/')) {
    return join(homedir(), p.slice(1));
  }
  return p;
}

export {
  loadConfig,
  saveConfig,
  getConfigDir,
  getConfigPath,
  expandHome,
  DEFAULT_DEFAULTS,
};
