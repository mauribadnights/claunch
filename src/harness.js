/**
 * Harness definitions for claunch v0.5+.
 *
 * A "harness" is a top-level CLI that claunch can spawn in a project directory.
 * Currently: claude (Claude Code), codex (OpenAI Codex), pi (Pi Coding Agent).
 *
 * For each harness we track:
 * - `bin`: command name on PATH
 * - `supports_agents`: whether `--agent <name>` is meaningful (Claude only)
 * - `cwd_flag`: explicit cwd flag if available (Codex `-C`); claunch uses spawn cwd
 *   regardless, but passes the flag too as belt-and-suspenders if defined
 * - `default_flags_key`: which key in `config.defaults` holds default flags
 * - `fingerprint_args`: args used to capture the help text for drift detection
 * - `leak_tokens`: substrings whose first appearance in --help signals an
 *   abstraction leak (a new mode/flag the launcher doesn't expose)
 */

export const HARNESSES = {
  claude: {
    name: 'claude',
    bin: 'claude',
    label: 'Claude Code',
    color: 'orange',
    description: 'Anthropic — agents, plan mode, MCP',
    supports_agents: true,
    default_flags_key: 'claude_flags',
    cwd_flag: null,
    fingerprint_args: ['--help'],
    leak_tokens: [
      '--remote',
      '--daemon',
      'app-server',
      'exec-server',
    ],
  },
  codex: {
    name: 'codex',
    bin: 'codex',
    label: 'Codex',
    color: 'green',
    description: 'OpenAI — sandbox+approval gates, feature flags',
    supports_agents: false,
    default_flags_key: 'codex_flags',
    cwd_flag: '-C',
    fingerprint_args: ['--help'],
    leak_tokens: [
      '--remote',
      'app-server',
      'exec-server',
      'mcp-server',
      'cloud',
      '--add-dir',
    ],
  },
  pi: {
    name: 'pi',
    bin: 'pi',
    label: 'Pi',
    color: 'purple',
    description: 'badlogic/pi-mono — no sub-agents, no sandbox',
    supports_agents: false,
    default_flags_key: 'pi_flags',
    cwd_flag: null,
    fingerprint_args: ['--help'],
    leak_tokens: [
      '--cwd',
      '--agent',
      '--sandbox',
      '--approval',
      '--dangerously-',
      '--exec',
      '--daemon',
    ],
  },
};

export const HARNESS_NAMES = Object.keys(HARNESSES);

export function getHarness(name) {
  return HARNESSES[name] || null;
}

export function isHarnessName(s) {
  return typeof s === 'string' && s in HARNESSES;
}

export function listHarnesses() {
  return Object.values(HARNESSES);
}
