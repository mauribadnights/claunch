import { spawnSync } from 'child_process';
import { recordAccess } from './frecency.js';

/**
 * Launch claude with the resolved agent configuration.
 * Uses spawnSync so the TTY is cleanly handed to claude
 * (no leftover raw-mode state from interactive prompts).
 *
 * @param {Object} opts - { dir, agent, addDirs, extraFlags, claudeFlags, passthrough, frecencyKey }
 *   frecencyKey: explicit key to record under. Defaults to `agent`. Callers pass an explicit
 *   key for pseudo-agents like "(plain claude)" so their usage is tracked.
 */
function launch(opts) {
  const { dir, agent, addDirs = [], extraFlags = [], claudeFlags = [], passthrough = [], frecencyKey } = opts;

  // Record frecency for agent and directory. Key falls back to the agent name, so callers
  // that want to track a pseudo-agent (e.g. plain claude with agent=null) must pass frecencyKey.
  const agentKey = frecencyKey || agent;
  if (agentKey) recordAccess('agents', agentKey);
  if (dir) recordAccess('directories', dir);

  const args = [];

  // Agent flag (null = plain claude, no agent)
  if (agent) {
    args.push('--agent', agent);
  }

  // Additional directories
  for (const d of addDirs) {
    args.push('--add-dir', d);
  }

  // Default flags from config (e.g., --dangerously-skip-permissions)
  args.push(...claudeFlags);

  // Per-agent extra flags
  args.push(...extraFlags);

  // Passthrough args from user
  args.push(...passthrough);

  const result = spawnSync('claude', args, {
    cwd: dir,
    stdio: 'inherit',
    env: { ...process.env },
  });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      console.error('Error: claude command not found. Is Claude Code installed?');
    } else {
      console.error(`Error launching claude: ${result.error.message}`);
    }
    process.exit(1);
  }

  process.exit(result.status ?? 0);
}

export { launch };
