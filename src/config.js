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

function loadConfig() {
  const path = getConfigPath();
  if (!existsSync(path)) {
    return { defaults: { claude_flags: [] }, scan_roots: [], projects: {} };
  }
  const raw = readFileSync(path, 'utf8');
  const config = YAML.parse(raw) || {};
  return {
    defaults: config.defaults || { claude_flags: [] },
    scan_roots: config.scan_roots || [],
    projects: config.projects || {},
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

export { loadConfig, saveConfig, getConfigDir, getConfigPath, expandHome };
