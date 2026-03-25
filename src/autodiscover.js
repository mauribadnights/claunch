import { readdirSync, statSync, existsSync } from 'fs';
import { join, basename, relative } from 'path';
import { homedir } from 'os';
import { loadConfig, saveConfig, expandHome } from './config.js';

const SKIP_DIRS = new Set(['.git', '.obsidian', 'node_modules', '.venv', '__pycache__', '.planning', '.stfolder', 'chroma_db']);

/** Markers that indicate a directory is a project */
const PROJECT_MARKERS = [
  '.claude/agents',
  'code',
  '.git',
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'Makefile',
  'CLAUDE.md',
];

function isProject(dir) {
  return PROJECT_MARKERS.some(marker => existsSync(join(dir, marker)));
}

/**
 * Scan a root directory for project directories.
 * A project is any directory containing one of PROJECT_MARKERS.
 * Once a project is found, we don't recurse into it (it's a leaf).
 * Returns array of { name, dir, agentsDir }
 */
function scanForProjects(rootDir) {
  const root = expandHome(rootDir);
  const found = [];

  function walk(dir, depth) {
    if (depth > 6) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    if (isProject(dir) && dir !== root) {
      const name = inferProjectName(dir, root);
      const agentsDir = join(dir, '.claude', 'agents');
      found.push({
        name,
        dir,
        agentsDir: existsSync(agentsDir) ? agentsDir : null,
      });
      return; // don't recurse into discovered projects
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.')) continue;
      walk(join(dir, entry.name), depth + 1);
    }
  }

  walk(root, 0);
  return found;
}

/**
 * Infer a short project name from directory path relative to root.
 */
function inferProjectName(dir, root) {
  return basename(dir).toLowerCase().replace(/\s+/g, '-');
}

/**
 * Auto-discover projects and merge into config.
 * Doesn't overwrite existing projects (preserves overrides).
 * Returns { added, existing }
 */
function autoDiscover(rootDir) {
  const projects = scanForProjects(rootDir);
  const config = loadConfig();
  const added = [];
  const existing = [];

  for (const proj of projects) {
    if (config.projects[proj.name]) {
      existing.push(proj.name);
      continue;
    }

    const entry = { dir: proj.dir };
    if (proj.agentsDir) entry.agents_dir = proj.agentsDir;
    config.projects[proj.name] = entry;
    added.push(proj.name);
  }

  // Also include global agents as a "global" project if ~/.claude/agents/ exists
  const globalAgentsDir = join(homedir(), '.claude', 'agents');
  if (existsSync(globalAgentsDir) && !config.projects.global) {
    config.projects.global = {
      dir: expandHome(rootDir),
      agents_dir: globalAgentsDir,
    };
    added.push('global');
  }

  if (added.length > 0) {
    saveConfig(config);
  }

  return { added, existing };
}

/**
 * Run autoDiscover across all configured scan_roots.
 * Returns { added, existing } aggregated.
 */
function autoDiscoverAll() {
  const config = loadConfig();
  const roots = config.scan_roots || [];
  const allAdded = [];
  const allExisting = [];

  for (const root of roots) {
    const resolved = expandHome(root);
    if (!existsSync(resolved)) continue;
    const { added, existing } = autoDiscover(resolved);
    allAdded.push(...added);
    allExisting.push(...existing);
  }

  return { added: allAdded, existing: allExisting };
}

export { scanForProjects, autoDiscover, autoDiscoverAll };
