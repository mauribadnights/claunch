#!/usr/bin/env node

import { loadConfig, saveConfig, expandHome, getConfigPath } from './config.js';
import { discoverAgents, resolveAgent } from './discovery.js';
import { launch } from './launcher.js';
import { generateZshCompletions, generateBashCompletions, generateFishCompletions, listProjects, listAgents } from './completions.js';
import { PLAIN_CLAUDE } from './interactive.js';
import { HARNESSES, isHarnessName } from './harness.js';
import { cmdAudit } from './audit.js';
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).version;

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
if (args[0] === '--list-harnesses') {
  console.log(Object.keys(HARNESSES).join('\n'));
  process.exit(0);
}

// No args: interactive picker (TTY) or text listing (pipe/CI)
if (args.length === 0) {
  if (process.stdin.isTTY && process.stdout.isTTY) {
    try {
      const { interactivePick } = await import('./interactive.js');
      await interactivePick();
    } catch (err) {
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
  case 'update':
  case 'upgrade':
    cmdUpdate();
    break;
  case 'audit':
    await cmdAudit(args.slice(1));
    process.exit(0);
    break;
  case 'help':
  case '--help':
  case '-h':
    showHelp();
    break;
  case '--version':
  case '-v':
    console.log(VERSION);
    break;
  default:
    // Treat as either: claunch <harness> <project> [agent] [extra-args...]
    //              or: claunch <project> [agent] [extra-args...]   (legacy, claude default)
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

  console.log('Harnesses:\n');
  for (const h of Object.values(HARNESSES)) {
    console.log(`  ${h.name.padEnd(8)} ${h.label} — ${h.description}`);
  }
}

function cmdInit() {
  const configPath = getConfigPath();
  if (existsSync(configPath)) {
    console.log(`Config already exists at ${configPath}`);
    return;
  }
  saveConfig({
    defaults: {
      claude_flags: ['--dangerously-skip-permissions'],
      codex_flags: ['--dangerously-bypass-approvals-and-sandbox', '--enable', 'goals'],
      pi_flags: [],
    },
    scan_roots: [],
    projects: {},
    harnesses: {},
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
      const rootDir = resolve(expandHome(scanArgs[0]));
      if (!existsSync(rootDir)) {
        console.error(`Directory not found: ${rootDir}`);
        process.exit(1);
      }
      ({ added, existing } = autoDiscover(rootDir));
    } else {
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

function cmdUpdate() {
  import('child_process').then(({ execSync }) => {
    const pkg = '@mauribadnights/claunch';
    console.log(`Checking for updates...`);
    try {
      const latest = execSync(`npm view ${pkg} version`, { encoding: 'utf8' }).trim();
      const current = VERSION;
      if (latest === current) {
        console.log(`Already on the latest version (${current})`);
        return;
      }
      console.log(`Updating ${current} -> ${latest}`);
      execSync(`npm install -g ${pkg}@latest`, { stdio: 'inherit' });
      console.log(`Updated to ${latest}`);
    } catch (err) {
      console.error('Update failed:', err.message);
      process.exit(1);
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
  // Detect harness prefix: `claunch claude ...`, `claunch codex ...`, `claunch pi ...`
  let harnessName = 'claude';
  let rest = launchArgs;

  if (isHarnessName(launchArgs[0])) {
    harnessName = launchArgs[0];
    rest = launchArgs.slice(1);
    if (rest.length === 0) {
      // Bare `claunch <harness>` — list projects for that harness
      showHarnessOverview(harnessName);
      return;
    }
  }

  const projectName = rest[0];
  const config = loadConfig();
  const project = config.projects[projectName];

  if (!project) {
    console.error(`Unknown project: "${projectName}"`);
    console.error(`Available: ${Object.keys(config.projects).join(', ') || '(none)'}`);
    console.error('Add one: claunch add <name> <directory>');
    process.exit(1);
  }

  if (harnessName === 'claude') {
    cmdLaunchClaude(rest, project, projectName, config);
  } else {
    cmdLaunchOther(harnessName, rest, project, config);
  }
}

function cmdLaunchClaude(rest, project, projectName, config) {
  // claunch <project> — list agents (legacy behavior preserved)
  if (rest.length === 1) {
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

  const agentName = rest[1];
  const passthrough = rest.slice(2);

  if (agentName === 'plain' || agentName === '--no-agent') {
    launch({
      harness: 'claude',
      dir: expandHome(project.dir),
      agent: null,
      addDirs: [],
      extraFlags: [],
      harnessFlags: config.defaults.claude_flags || [],
      passthrough,
      frecencyKey: PLAIN_CLAUDE,
    });
    return;
  }

  const resolved = resolveAgent(project, agentName);

  launch({
    harness: 'claude',
    ...resolved,
    harnessFlags: config.defaults.claude_flags || [],
    passthrough,
  });
}

function cmdLaunchOther(harnessName, rest, project, config) {
  // claunch codex <project> [args...] OR claunch pi <project> [args...]
  const passthrough = rest.slice(1);
  const harness = HARNESSES[harnessName];
  const flagsKey = harness.default_flags_key;

  launch({
    harness: harnessName,
    dir: expandHome(project.dir),
    harnessFlags: config.defaults[flagsKey] || [],
    passthrough,
    frecencyKey: `(${harnessName})`,
  });
}

function showHarnessOverview(harnessName) {
  const harness = HARNESSES[harnessName];
  const config = loadConfig();
  const projects = Object.entries(config.projects);

  console.log(`${harness.label} (${harness.name})\n`);
  console.log(`  ${harness.description}`);
  console.log(`  bin: ${harness.bin}`);
  console.log(`  default flags: ${(config.defaults[harness.default_flags_key] || []).join(' ') || '(none)'}`);
  console.log(`\nProjects (use \`claunch ${harnessName} <project>\`):\n`);
  for (const [name] of projects) {
    console.log(`  ${name}`);
  }
}

function showHelp() {
  console.log(`claunch — Universal launcher for Claude Code, Codex, and Pi

Usage:
  claunch                                Interactive harness/agent/dir picker
  claunch <project>                      List agents for a project (Claude default)
  claunch <project> <agent> [args...]    Launch Claude with agent in project
  claunch <harness> <project> [args...]  Launch a specific harness in a project
                                         <harness> ∈ ${Object.keys(HARNESSES).join(', ')}

Commands:
  add <name> <dir> [--agents-dir <p>]    Register a project
  remove <name>                          Unregister a project
  scan [root-dir]                        Auto-discover projects
  list                                   List projects + harnesses
  init                                   Create default config
  update                                 Update claunch to the latest version
  audit [harness]                        Check harnesses for CLI surface drift
  completions <zsh|bash|fish>            Print shell completions

Examples:
  claunch                                Pick interactively
  claunch driffusion cto                 Claude + cto agent in driffusion dir
  claunch codex driffusion               Codex in driffusion dir (auto bypass + goals)
  claunch pi thesis                      Pi in thesis dir
  claunch audit codex                    Check if Codex CLI changed since last ack

Config: ${getConfigPath()}
`);
}
