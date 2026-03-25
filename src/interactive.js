import { readdirSync } from 'fs';
import { join, basename, relative } from 'path';
import { homedir } from 'os';
import { loadConfig, expandHome } from './config.js';
import { discoverAgents, resolveAgent } from './discovery.js';
import { launch } from './launcher.js';
import { splitPanelSelect } from './tui.js';
import { getScores } from './frecency.js';

const PLAIN_CLAUDE = '(plain claude)';
const SKIP_DIRS = new Set(['.git', '.obsidian', 'node_modules', '.venv', '__pycache__', '.planning', '.stfolder', '.claude', 'chroma_db']);

async function interactivePick() {
  const config = loadConfig();
  const projects = Object.entries(config.projects);

  if (projects.length === 0) {
    console.log('No projects configured.');
    console.log('Run: claunch add <name> <directory>');
    console.log('Or:  claunch scan <root-directory>');
    return;
  }

  const agentFrecency = getScores('agents');
  const dirFrecency = getScores('directories');

  const globalAgentsDir = join(homedir(), '.claude', 'agents');

  // Build flat agent list
  const agentItems = [];

  // Plain claude — global
  agentItems.push({
    label: PLAIN_CLAUDE,
    tag: 'global',
    description: 'launch claude without an agent',
    color: 'cyan',
    value: { agentName: null, sourceProject: null, agentDir: null, isGlobal: true },
    searchText: 'plain claude no agent global',
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
      const color = agent?.color || null;

      agentItems.push({
        label: agentName,
        tag,
        description: desc,
        color,
        value: { agentName, sourceProject: projectName, agentDir: agentRootDir, isGlobal },
        searchText: `${tag} ${agentName} ${desc}`,
      });
    }
  }

  // Directory items builder — scoped to agent's declaration level
  function dirItemsFn(agentValue) {
    const { agentDir, isGlobal } = agentValue;
    const dirItems = [];

    if (isGlobal || !agentDir) {
      // Global agents: all registered project dirs + subdirectories
      for (const [projName, projConfig] of projects) {
        const dir = expandHome(projConfig.dir);
        addDirWithChildren(dirItems, projName, dir, 2);
      }
    } else {
      // Project agent: only dirs at or below the agent's declaration directory
      // Add the agent's own directory tree
      const parentProject = projects.find(([, p]) => expandHome(p.dir) === agentDir);
      const label = parentProject ? parentProject[0] : basename(agentDir).toLowerCase();
      addDirWithChildren(dirItems, label, agentDir, 3);

      // Also add any registered projects that are children of agentDir
      for (const [projName, projConfig] of projects) {
        const dir = expandHome(projConfig.dir);
        if (dir !== agentDir && dir.startsWith(agentDir + '/')) {
          // Already covered by walk above, but ensure overrides are included
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

    // Deduplicate
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
  console.log(`\x1b[2m${agentLabel} in ${shortenPath(targetDir)}\x1b[0m`);

  if (agentName === null) {
    launch({
      dir: targetDir,
      agent: null,
      addDirs: [],
      extraFlags: [],
      claudeFlags: config.defaults?.claude_flags || [],
      passthrough: [],
    });
  } else {
    const sourceConfig = config.projects[sourceProject];
    const resolved = resolveAgent(sourceConfig, agentName);
    launch({
      ...resolved,
      dir: targetDir,
      claudeFlags: config.defaults?.claude_flags || [],
      passthrough: [],
    });
  }
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

export { interactivePick };
