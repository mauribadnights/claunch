import { spawnSync } from 'child_process';
import { recordAccess } from './frecency.js';

/**
 * Launch claude with the resolved agent configuration.
 * Uses spawnSync so the TTY is cleanly handed to claude
 * (no leftover raw-mode state from interactive prompts).
 *
 * @param {Object} opts - { dir, agent, addDirs, extraFlags, claudeFlags, passthrough }
 */
function launch(opts) {
  const { dir, agent, addDirs = [], extraFlags = [], claudeFlags = [], passthrough = [] } = opts;

  // Record frecency for agent and directory
  if (agent) recordAccess('agents', agent);
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
