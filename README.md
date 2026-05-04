# claunch

**Universal launcher for Claude Code, Codex, and Pi.** One TUI, every harness, no aliases.

[![npm version](https://img.shields.io/npm/v/@mauribadnights/claunch.svg)](https://www.npmjs.com/package/@mauribadnights/claunch)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Why

Three coding agents now: Claude Code, OpenAI Codex, Pi. Each one has its own quirks — different bypass flags, different sub-agent stories, different cwd assumptions. Three different launchers means three different muscle-memory paths and three sets of flags I have to remember to type every time.

claunch v0.5 collapses all of them behind one command:

```bash
$ claunch                # or just `c`

harness > _
> Claude Code   Anthropic — agents, plan mode, MCP
  Codex         OpenAI — sandbox+approval gates, feature flags
  Pi            badlogic/pi-mono — no sub-agents, no sandbox
3 | type to filter | enter to select | esc to cancel
```

Pick a harness → (if Claude) pick an agent → pick a directory → it launches with all the flags you'd otherwise type by hand.

## Install

```bash
npm install -g @mauribadnights/claunch
```

Adds two binaries to your `$PATH`: `claunch` and `c` (alias).

## Usage

```bash
# Interactive: harness → agent (Claude only) → directory
c

# Direct, Claude default (backward-compatible with v0.4)
c myapp                       # list agents
c myapp cto                   # launch claude --agent cto in myapp/

# Explicit harness
c claude myapp cto            # same as above
c codex myapp                 # codex with auto bypass + goals
c pi myapp                    # pi in myapp/

# Pass extra args through
c codex myapp "fix the auth bug"
c pi myapp --model openai-codex/gpt-5.5
```

## Default flags per harness

claunch auto-injects sane defaults so you never re-type them:

| Harness | Default flags                                                                      |
| ------- | ---------------------------------------------------------------------------------- |
| Claude  | `--dangerously-skip-permissions`                                                   |
| Codex   | `--dangerously-bypass-approvals-and-sandbox --enable goals`                        |
| Pi      | (none — Pi has no sandbox or sub-agent gates by design)                            |

Customize in `~/.claunch/config.yaml`:

```yaml
defaults:
  claude_flags:
    - --dangerously-skip-permissions
  codex_flags:
    - --dangerously-bypass-approvals-and-sandbox
    - --enable
    - goals
  pi_flags: []
```

> **Footgun:** an explicit empty list (`codex_flags: []`) overrides the defaults — if you remove the bypass flag from Codex this way, Codex will prompt for approval on every action. To restore defaults, remove the key from the file rather than setting it to `[]`.

## Drift detector — never silently break

When Codex or Pi adds a new mode (a `--remote` flag, a non-cwd scoped mode, a new sub-agent system) the launcher abstraction can silently leak — claunch keeps shipping the same flags while the harness has grown new options that bypass it.

claunch v0.5 hashes each harness's `--help` output and compares it to the last acknowledged baseline. When it changes:

```
⚠ pi CLI surface changed since 2026-05-04.
  claunch's launcher model may not expose new modes/flags.
  Possible abstraction leaks (new tokens):
    + --cwd
  1 new line(s) in --help. Sample:
    +   --cwd <dir>     Override working directory
  Review and acknowledge: `claunch audit pi`
```

The cache refreshes asynchronously every 24h, so the runtime overhead is one file read + sha256 (~5 ms per launch). Drift fires once per change until you acknowledge with:

```bash
claunch audit                 # summary of all harnesses
claunch audit pi              # full diff + interactive acknowledge
```

Each harness has a list of "leak tokens" — substrings that, when newly appearing in `--help`, signal a likely abstraction leak. For Pi: `--cwd`, `--agent`, `--sandbox`, `--dangerously-*`, `--exec`, `--daemon`. For Codex: `--remote`, `app-server`, `mcp-server`, `cloud`. Tweak in `src/harness.js` if you fork.

## Project registration

claunch tracks projects so you don't type paths:

```bash
claunch add myapp ~/projects/myapp
claunch add infra ~/infrastructure
claunch scan ~/projects                  # auto-discover under a root
claunch list                             # show registered projects + harnesses
```

For Claude Code, agents are auto-discovered from each project's `.claude/agents/` directory:

```
~/projects/myapp/
├── .claude/
│   └── agents/
│       ├── cto.md
│       ├── designer.md
│       └── devops.md
```

`claunch myapp cto` then runs `claude --agent cto` in `~/projects/myapp/` with your default flags.

## Config

`~/.claunch/config.yaml`:

```yaml
defaults:
  claude_flags:
    - --dangerously-skip-permissions
  codex_flags:
    - --dangerously-bypass-approvals-and-sandbox
    - --enable
    - goals
  pi_flags: []

scan_roots:
  - ~/projects
  - ~/work

projects:
  myapp:
    dir: ~/projects/myapp
  infra:
    dir: ~/infrastructure
    agents_dir: ~/shared-agents      # override Claude agent discovery path
    overrides:
      cto-code:
        dir: ~/projects/myapp/packages/core
        add_dirs:
          - ~/projects/myapp/docs
        agent: cto

harnesses:                           # auto-managed by drift detector
  claude:
    bin: claude
    cli_signature_sha: <sha>
    last_audited: 2026-05-04
```

## All commands

```
claunch                                  Interactive picker
claunch <project>                        List Claude agents (legacy)
claunch <project> <agent> [args...]      Launch Claude with agent
claunch <harness> <project> [args...]    Launch a specific harness
                                         <harness> ∈ claude, codex, pi

claunch add <name> <dir>                 Register a project
claunch remove <name>                    Unregister a project
claunch scan [root-dir]                  Auto-discover projects
claunch list                             Show projects + harnesses
claunch audit [harness]                  Check for CLI surface drift
claunch init                             Create default config
claunch update                           Update to latest version
claunch completions <zsh|bash|fish>      Print shell completions
```

## Reserved names

These project names are unreachable as positional args (they collide with subcommands): `list`, `init`, `add`, `remove`, `scan`, `audit`, `update`, `upgrade`, `completions`, `help`. And these are the harness aliases: `claude`, `codex`, `pi`. Don't name a project after them.

## Shell completions

```bash
# zsh
eval "$(claunch completions zsh)"

# bash
eval "$(claunch completions bash)"

# fish
claunch completions fish > ~/.config/fish/completions/claunch.fish
```

Completions also work with the `c` alias.

## Requirements

- Node.js >= 18
- At least one of: [Claude Code](https://claude.ai/code), [OpenAI Codex CLI](https://www.npmjs.com/package/@openai/codex), [Pi Coding Agent](https://www.npmjs.com/package/@mariozechner/pi-coding-agent)

claunch silently skips drift detection for harnesses whose binary isn't installed.

## License

MIT
