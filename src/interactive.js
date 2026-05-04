import { readdirSync } from 'fs';
import { join, basename, relative } from 'path';
import { homedir } from 'os';
import { loadConfig, expandHome } from './config.js';
import { discoverAgents, resolveAgent } from './discovery.js';
import { launch } from './launcher.js';
import { splitPanelSelect } from './tui.js';
import { verticalPick } from './picker.js';
import { getScores } from './frecency.js';
import { listHarnesses, HARNESSES } from './harness.js';

const PLAIN_CLAUDE = '(plain claude)';
const SKIP_DIRS = new Set(['.git', '.obsidian', 'node_modules', '.venv', '__pycache__', '.planning', '.stfolder', '.claude', 'chroma_db']);

/**
 * Top-level interactive entry. Two-step:
 *   1. harness picker (claude/codex/pi)
 *   2. agent + dir picker (claude) OR dir picker (codex/pi)
 */
async function interactivePick() {
  const config = loadConfig();
  const projects = Object.entries(config.projects);

  if (projects.length === 0) {
    console.log('No projects configured.');
    console.log('Run: claunch add <name> <directory>');
    console.log('Or:  claunch scan <root-directory>');
    return;
  }

  // Step 1: harness picker
  const harnessFrecency = getScores('harnesses');
  const harnessItems = listHarnesses().map(h => ({
    label: h.label,
    description: h.description,
    color: h.color,
    value: h.name,
    searchText: `${h.name} ${h.label} ${h.description}`,
  }));

  const chosenHarness = await verticalPick({
    title: 'harness',
    items: harnessItems,
    maxVisible: harnessItems.length,
    frecency: harnessFrecency,
    frecencyKeyFn: (item) => item.value,
  });

  if (!chosenHarness) return;

  if (chosenHarness === 'claude') {
    await claudePick(config, projects);
  } else {
    await dirOnlyPick(chosenHarness, config, projects);
  }
}

/**
 * Claude flow — preserved from v0.4: agent picker then dir picker via the
 * animated split-panel TUI.
 */
async function claudePick(config, projects) {
  const agentFrecency = getScores('agents');
  const dirFrecency = getScores('directories');

  const globalAgentsDir = join(homedir(), '.claude', 'agents');

  const agentItems = [];

  agentItems.push({
    label: PLAIN_CLAUDE,
    tag: 'global',
    description: 'launch claude without an agent',
    color: 'cyan',
    value: { agentName: null, sourceProject: null, agentDir: null, isGlobal: true },
    searchText: `${PLAIN_CLAUDE} no agent`,
  });

  for (const [projectName, projectConfig] of projects) {
    const resolvedAgentsDir = projectConfig.agents_dir
      ? expandHome(projectConfig.agents_dir)
      : join(expandHome(projectConfig.dir), '.claude', 'agents');

    const isGlobal = resolvedAgentsDir === globalAgentsDir;
    const tag = isGlobal ? 'global' : projectName;
    const agentRootDir = expandHome(projectConfig.dir);

    const agents = discoverAgents(projectConfig);
    const overrideNames = Object.keys(projectConfig.overrides || {});
    const allNames = new Set([...agents.map(a => a.name), ...overrideNames]);

    for (const agentName of [...allNames].sort()) {
      const agent = agents.find(a => a.name === agentName);
      const desc = agent?.description || (projectConfig.overrides?.[agentName] ? 'override' : '');
      const colorName = agent?.color || null;

      agentItems.push({
        label: agentName,
        tag,
        description: desc,
        color: colorName,
        value: { agentName, sourceProject: projectName, agentDir: agentRootDir, isGlobal },
        searchText: `${tag} ${agentName} ${desc}`,
      });
    }
  }

  function dirItemsFn(agentValue) {
    const { agentDir, isGlobal } = agentValue;
    const dirItems = [];

    if (isGlobal || !agentDir) {
      for (const [projName, projConfig] of projects) {
        const dir = expandHome(projConfig.dir);
        addDirWithChildren(dirItems, projName, dir, 2);
      }
    } else {
      const parentProject = projects.find(([, p]) => expandHome(p.dir) === agentDir);
      const label = parentProject ? parentProject[0] : basename(agentDir).toLowerCase();
      addDirWithChildren(dirItems, label, agentDir, 3);

      for (const [projName, projConfig] of projects) {
        const dir = expandHome(projConfig.dir);
        if (dir !== agentDir && dir.startsWith(agentDir + '/')) {
          if (projConfig.overrides) {
            for (const [, override] of Object.entries(projConfig.overrides)) {
              if (override.dir) {
                const od = expandHome(override.dir);
                if (!dirItems.some(d => d.value.dir === od)) {
                  addDirWithChildren(dirItems, projName, od, 1);
                }
              }
            }
          }
        }
      }
    }

    const seen = new Set();
    return dirItems.filter(item => {
      if (seen.has(item.value.dir)) return false;
      seen.add(item.value.dir);
      return true;
    });
  }

  const result = await splitPanelSelect({
    agentItems,
    dirItemsFn,
    maxVisible: 13,
    agentFrecency,
    dirFrecency,
  });

  if (!result) return;

  const { agent, dir } = result;
  const { agentName, sourceProject } = agent;

  const targetDir = dir || expandHome(config.projects[sourceProject]?.dir || '~');
  const agentLabel = agentName || 'plain claude';

  process.stdout.write('\x1b[2J\x1b[H');
  console.log(`\x1b[2m${agentLabel} in ${shortenPath(targetDir)}\x1b[0m`);

  if (agentName === null) {
    launch({
      harness: 'claude',
      dir: targetDir,
      agent: null,
      addDirs: [],
      extraFlags: [],
      harnessFlags: config.defaults?.claude_flags || [],
      passthrough: [],
      frecencyKey: PLAIN_CLAUDE,
    });
  } else {
    const sourceConfig = config.projects[sourceProject];
    const resolved = resolveAgent(sourceConfig, agentName);
    launch({
      harness: 'claude',
      ...resolved,
      dir: targetDir,
      harnessFlags: config.defaults?.claude_flags || [],
      passthrough: [],
    });
  }
}

/**
 * Codex/Pi flow — single-step dir picker. Skips the agent step entirely
 * (these harnesses don't expose sub-agents on the CLI).
 */
async function dirOnlyPick(harnessName, config, projects) {
  const harness = HARNESSES[harnessName];
  const dirFrecency = getScores('directories');

  const dirItems = [];
  for (const [projName, projConfig] of projects) {
    const dir = expandHome(projConfig.dir);
    addDirWithChildren(dirItems, projName, dir, 2);
  }

  const seen = new Set();
  const dedupedItems = dirItems.filter(item => {
    if (seen.has(item.value.dir)) return false;
    seen.add(item.value.dir);
    return true;
  });

  const dirValue = await verticalPick({
    title: `${harness.label} — directory`,
    items: dedupedItems,
    maxVisible: 13,
    frecency: dirFrecency,
    frecencyKeyFn: (item) => item.value.dir,
  });

  if (!dirValue) return;

  const targetDir = dirValue.dir;
  process.stdout.write('\x1b[2J\x1b[H');
  console.log(`\x1b[2m${harness.label} in ${shortenPath(targetDir)}\x1b[0m`);

  // Track harness frecency too so the harness picker remembers preferences
  const { recordAccess } = await import('./frecency.js');
  recordAccess('harnesses', harnessName);

  const flagsKey = harness.default_flags_key;
  launch({
    harness: harnessName,
    dir: targetDir,
    harnessFlags: config.defaults?.[flagsKey] || [],
    passthrough: [],
    frecencyKey: `(${harnessName})`,
  });
}

function addDirWithChildren(items, projectLabel, rootDir, maxDepth) {
  walkDirs(rootDir, 0, maxDepth, (dir, depth) => {
    const rel = relative(rootDir, dir);
    const label = rel ? `${projectLabel}/${rel}` : projectLabel;
    items.push({
      label,
      tag: null,
      description: shortenPath(dir),
      value: { dir },
      searchText: `${label} ${dir} ${basename(dir)}`,
    });
  });
}

function walkDirs(dir, depth, maxDepth, callback) {
  callback(dir, depth);
  if (depth >= maxDepth) return;

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith('.')) continue;
    walkDirs(join(dir, entry.name), depth + 1, maxDepth, callback);
  }
}

function shortenPath(p) {
  const home = homedir();
  return p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

export { interactivePick, PLAIN_CLAUDE };
