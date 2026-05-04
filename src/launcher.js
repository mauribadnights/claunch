import { spawnSync } from 'child_process';
import { recordAccess } from './frecency.js';
import { HARNESSES } from './harness.js';
import { checkDrift, surfaceDriftWarning } from './drift.js';

/**
 * Launch a harness in a project directory.
 *
 * @param {Object} opts
 * @param {string} [opts.harness='claude']     Harness name (claude/codex/pi)
 * @param {string} opts.dir                    Working directory (cwd)
 * @param {string|null} [opts.agent]           Agent name (Claude only)
 * @param {string[]} [opts.addDirs]            Extra read/write dirs (Claude --add-dir)
 * @param {string[]} [opts.harnessFlags]       Default flags for this harness from config.defaults
 * @param {string[]} [opts.extraFlags]         Per-agent extras (Claude only)
 * @param {string[]} [opts.passthrough]        Trailing args from CLI
 * @param {string} [opts.frecencyKey]          Explicit frecency key
 *
 * Backward-compat note: prior versions accepted `claudeFlags` instead of
 * `harnessFlags`. We accept both for one release.
 */
function launch(opts) {
  const {
    harness: harnessName = 'claude',
    dir,
    agent,
    addDirs = [],
    harnessFlags,
    claudeFlags, // legacy alias
    extraFlags = [],
    passthrough = [],
    frecencyKey,
  } = opts;

  const harness = HARNESSES[harnessName];
  if (!harness) {
    console.error(`Error: unknown harness "${harnessName}". Known: ${Object.keys(HARNESSES).join(', ')}`);
    process.exit(1);
  }

  // Drift check — fast path is ~5ms (read cache + sha compare); refresh is async.
  // Wrapped in try/catch so a broken drift module never blocks a launch.
  try {
    const drift = checkDrift(harnessName);
    surfaceDriftWarning(drift, harnessName);
  } catch (err) {
    if (process.env.CLAUNCH_DEBUG) {
      process.stderr.write(`[claunch] drift check failed: ${err.message}\n`);
    }
  }

  const flags = harnessFlags ?? claudeFlags ?? [];

  // Frecency: track agent (or pseudo-agent for non-claude harnesses) and dir
  const agentKey = frecencyKey || agent || `(${harnessName})`;
  recordAccess('agents', agentKey);
  if (dir) recordAccess('directories', dir);

  const args = buildArgs(harness, { agent, addDirs, flags, extraFlags, passthrough, dir });

  const result = spawnSync(harness.bin, args, {
    cwd: dir,
    stdio: 'inherit',
    env: { ...process.env },
  });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      console.error(`Error: '${harness.bin}' command not found. Is ${harness.label} installed?`);
    } else {
      console.error(`Error launching ${harness.bin}: ${result.error.message}`);
    }
    process.exit(1);
  }

  process.exit(result.status ?? 0);
}

/**
 * Build the argv for a harness. Knowledge of which flags apply to which
 * harness lives here.
 */
function buildArgs(harness, { agent, addDirs, flags, extraFlags, passthrough, dir }) {
  const args = [];

  if (harness.name === 'claude') {
    if (agent) args.push('--agent', agent);
    for (const d of addDirs) args.push('--add-dir', d);
    args.push(...flags);
    args.push(...extraFlags);
    args.push(...passthrough);
  } else if (harness.name === 'codex') {
    // Codex has no --agent. -C is supported for explicit cwd; we still spawn
    // with cwd=dir so omitting -C is harmless. We DON'T pass it by default to
    // keep argv minimal.
    args.push(...flags);
    args.push(...passthrough);
  } else if (harness.name === 'pi') {
    // Pi has no --cwd, no --agent, no sandbox flags. We spawn in dir.
    args.push(...flags);
    args.push(...passthrough);
  } else {
    args.push(...flags);
    args.push(...passthrough);
  }

  return args;
}

export { launch, buildArgs };
