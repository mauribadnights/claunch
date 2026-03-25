#!/usr/bin/env node

import { loadConfig, saveConfig, expandHome, getConfigPath } from './config.js';
import { discoverAgents, resolveAgent } from './discovery.js';
import { launch } from './launcher.js';
import { generateZshCompletions, generateBashCompletions, generateFishCompletions, listProjects, listAgents } from './completions.js';
import { existsSync } from 'fs';
import { resolve } from 'path';

const args = process.argv.slice(2);

// Internal flags for completion helpers
if (args[0] === '--list-projects') {
  console.log(listProjects());
  process.exit(0);
}
if (args[0] === '--list-agents' && args[1]) {
  console.log(listAgents(args[1]));
  process.exit(0);
}

// No args: interactive picker (TTY) or text listing (pipe/CI)
if (args.length === 0) {
  if (process.stdin.isTTY && process.stdout.isTTY) {
    try {
      const { interactivePick } = await import('./interactive.js');
      await interactivePick();
    } catch (err) {
      // Fall back to text listing if raw mode / TTY fails
      if (err.code === 'ERR_INVALID_FD_TYPE' || err.message?.includes('setRawMode')) {
        showOverview();
      } else {
        throw err;
      }
    }
  } else {
    showOverview();
  }
  process.exit(0);
}

const command = args[0];

switch (command) {
  case 'list':
  case '--list':
  case 'ls':
    showOverview();
    process.exit(0);
    break;
  case 'init':
    cmdInit();
    break;
  case 'add':
    cmdAdd(args.slice(1));
    break;
  case 'remove':
    cmdRemove(args.slice(1));
    break;
  case 'scan':
    cmdScan(args.slice(1));
    break;
  case 'completions':
    cmdCompletions(args[1]);
    break;
  case 'help':
  case '--help':
  case '-h':
    showHelp();
    break;
  case '--version':
  case '-v':
    console.log('0.1.0');
    break;
  default:
    // Treat as: claunch <project> [agent] [extra-args...]
    cmdLaunch(args);
    break;
}

function showOverview() {
  const config = loadConfig();
  const projects = Object.entries(config.projects);

  if (projects.length === 0) {
    console.log('No projects configured. Run: claunch add <name> <directory>');
    return;
  }

  console.log('Projects:\n');
  for (const [name, proj] of projects) {
    const dir = expandHome(proj.dir);
    const agents = discoverAgents(proj);
    const overrideNames = Object.keys(proj.overrides || {});
    const allNames = new Set([...agents.map(a => a.name), ...overrideNames]);
    const agentList = [...allNames].sort();

    console.log(`  ${name}`);
    console.log(`    dir: ${dir}`);
    if (agentList.length > 0) {
      console.log(`    agents: ${agentList.join(', ')}`);
    } else {
      console.log('    agents: (none found)');
    }
    console.log();
  }
}

function cmdInit() {
  const configPath = getConfigPath();
  if (existsSync(configPath)) {
    console.log(`Config already exists at ${configPath}`);
    return;
  }
  saveConfig({
    defaults: { claude_flags: [] },
    projects: {},
  });
  console.log(`Created config at ${configPath}`);
  console.log('Add a project: claunch add <name> <directory>');
}

function cmdAdd(addArgs) {
  if (addArgs.length < 2) {
    console.error('Usage: claunch add <name> <directory> [--agents-dir <path>]');
    process.exit(1);
  }

  const name = addArgs[0];
  const dir = resolve(expandHome(addArgs[1]));

  if (!existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    process.exit(1);
  }

  let agentsDir = null;
  const adIdx = addArgs.indexOf('--agents-dir');
  if (adIdx !== -1 && addArgs[adIdx + 1]) {
    agentsDir = addArgs[adIdx + 1];
  }

  const config = loadConfig();
  const entry = { dir };
  if (agentsDir) entry.agents_dir = agentsDir;

  config.projects[name] = entry;
  saveConfig(config);

  const agents = discoverAgents(entry);
  console.log(`Added project "${name}" at ${dir}`);
  if (agents.length > 0) {
    console.log(`Discovered agents: ${agents.map(a => a.name).join(', ')}`);
  } else {
    console.log('No agents found in .claude/agents/');
  }
}

function cmdRemove(removeArgs) {
  if (removeArgs.length < 1) {
    console.error('Usage: claunch remove <name>');
    process.exit(1);
  }

  const name = removeArgs[0];
  const config = loadConfig();

  if (!config.projects[name]) {
    console.error(`Project "${name}" not found`);
    process.exit(1);
  }

  delete config.projects[name];
  saveConfig(config);
  console.log(`Removed project "${name}"`);
}

function cmdScan(scanArgs) {
  import('./autodiscover.js').then(({ autoDiscover, autoDiscoverAll }) => {
    let added, existing;

    if (scanArgs.length >= 1) {
      // Explicit root dir
      const rootDir = resolve(expandHome(scanArgs[0]));
      if (!existsSync(rootDir)) {
        console.error(`Directory not found: ${rootDir}`);
        process.exit(1);
      }
      ({ added, existing } = autoDiscover(rootDir));
    } else {
      // Use configured scan_roots
      const config = loadConfig();
      if (config.scan_roots.length === 0) {
        console.error('No scan_roots configured. Add them to ~/.claunch/config.yaml or pass a directory:');
        console.error('  claunch scan <root-directory>');
        process.exit(1);
      }
      console.log(`Scanning roots: ${config.scan_roots.join(', ')}`);
      ({ added, existing } = autoDiscoverAll());
    }

    if (added.length > 0) {
      console.log(`Added ${added.length} project(s): ${added.join(', ')}`);
    }
    if (existing.length > 0) {
      console.log(`Already registered: ${existing.join(', ')}`);
    }
    if (added.length === 0 && existing.length === 0) {
      console.log('No projects found.');
    }
  });
}

function cmdCompletions(shell) {
  switch (shell) {
    case 'zsh':
      console.log(generateZshCompletions());
      break;
    case 'bash':
      console.log(generateBashCompletions());
      break;
    case 'fish':
      console.log(generateFishCompletions());
      break;
    default:
      console.error('Usage: claunch completions <zsh|bash|fish>');
      process.exit(1);
  }
}

function cmdLaunch(launchArgs) {
  const projectName = launchArgs[0];
  const config = loadConfig();
  const project = config.projects[projectName];

  if (!project) {
    console.error(`Unknown project: "${projectName}"`);
    console.error(`Available: ${Object.keys(config.projects).join(', ') || '(none)'}`);
    console.error('Add one: claunch add <name> <directory>');
    process.exit(1);
  }

  // claunch <project> — list agents
  if (launchArgs.length === 1) {
    const agents = discoverAgents(project);
    const overrideNames = Object.keys(project.overrides || {});
    const allNames = new Set([...agents.map(a => a.name), ...overrideNames]);
    const agentList = [...allNames].sort();

    console.log(`Agents for ${projectName}:\n`);
    for (const name of agentList) {
      const agent = agents.find(a => a.name === name);
      const desc = agent?.description || (project.overrides?.[name] ? '(override)' : '');
      console.log(`  ${name}${desc ? ` — ${desc}` : ''}`);
    }
    if (agentList.length === 0) {
      console.log('  (none found)');
    }
    return;
  }

  // claunch <project> <agent> [extra-args...]
  const agentName = launchArgs[1];
  const passthrough = launchArgs.slice(2);

  // Plain claude (no agent)
  if (agentName === 'plain' || agentName === '--no-agent') {
    launch({
      dir: expandHome(project.dir),
      agent: null,
      addDirs: [],
      extraFlags: [],
      claudeFlags: config.defaults.claude_flags || [],
      passthrough,
    });
    return;
  }

  // Check project agents first, then fall back to vault/global agents
  const resolved = resolveAgent(project, agentName);

  launch({
    ...resolved,
    claudeFlags: config.defaults.claude_flags || [],
    passthrough,
  });
}

function showHelp() {
  console.log(`claunch — Universal agent launcher for Claude Code

Usage:
  claunch                              Interactive project/agent picker
  claunch <project>                    List agents for a project
  claunch <project> <agent> [args...]  Launch an agent in project context

Commands:
  add <name> <dir> [--agents-dir <p>]  Register a project
  remove <name>                        Unregister a project
  scan [root-dir]                      Auto-discover projects (uses scan_roots if no arg)
  list                                 List all projects and agents (non-interactive)
  init                                 Create default config
  completions <zsh|bash|fish>          Print shell completions

Config: ${getConfigPath()}
`);
}
