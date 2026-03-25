# claunch

**Universal agent launcher for Claude Code.** Manage project-specific agents from anywhere.

[![npm version](https://img.shields.io/npm/v/@mauribadnights/claunch.svg)](https://www.npmjs.com/package/@mauribadnights/claunch)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Why I Built This

I don't know about you, but as I started making different agents for different things, and was simultaneously working on a hundred different projects, I got tired of constantly running long commands to navigate to the directory I want and call the agent I need. At first I fixed it using shell aliases, but that got messy fast and I couldn't keep track of all of them:

```bash
alias claude-cto="cd ~/projects/myapp && claude --agent cto"
alias claude-designer="cd ~/projects/myapp && claude --agent designer"
alias claude-devops="cd ~/infra && claude --agent devops"
# ... 15 more aliases that I'll definitely forget about ...
```

So I built a smart fuzzy agent and project picker to get into my projects faster than ever.

## The Fix

```bash
npm install -g @mauribadnights/claunch
```

```
$ claunch

agent > _                    |  ▐▛███▜▌
> cto          [myapp]       | ▝▜█████▛▘  hey!
  designer     [myapp]       |   ▘▘ ▝▝
  devops       [infra]       |
  builder      [global]      |   cto
  (plain claude) [global]    |   Technical architect and
                             |   engineering lead
6 | type to filter | enter   |
```

One command. Split-panel TUI. Fuzzy search. No aliases.

## Quick Start

```bash
# Install
npm install -g @mauribadnights/claunch

# Register a project (auto-discovers agents from .claude/agents/)
claunch add myapp ~/projects/myapp
claunch add infra ~/infrastructure

# Or auto-discover everything under a root
claunch scan ~/projects

# Launch interactively
claunch

# Or directly
claunch myapp cto
```

## How It Works

claunch reads agent definitions from each project's `.claude/agents/` directory -- the same place Claude Code already looks for agents. No new config format to learn.

```
~/projects/myapp/
├── .claude/
│   └── agents/
│       ├── cto.md          <- claunch discovers these
│       ├── designer.md
│       └── devops.md
├── src/
└── ...
```

When you run `claunch myapp cto`, it:
1. `cd`s to `~/projects/myapp/`
2. Runs `claude --agent cto` (plus any default flags you've configured)

The interactive TUI goes further -- after picking an agent, you get a second panel to pick which directory to launch in, with fuzzy search on both. It tracks what you use most with frecency ranking (Mozilla-style exponential decay, 14-day half-life) so your favorites float to the top over time.

## Usage

```
claunch                              Interactive project/agent picker
claunch <project>                    List agents for a project
claunch <project> <agent> [args...]  Launch an agent in project context

claunch add <name> <dir>             Register a project
claunch remove <name>                Unregister a project
claunch scan [root-dir]              Auto-discover projects
claunch list                         List all projects (non-interactive)
claunch init                         Create default config
claunch update                       Update claunch to the latest version
claunch completions <zsh|bash|fish>  Print shell completions
```

## Configuration

Config lives at `~/.claunch/config.yaml`:

```yaml
defaults:
  claude_flags: []  # flags appended to every launch

scan_roots:         # directories for `claunch scan`
  - ~/projects
  - ~/work

projects:
  myapp:
    dir: ~/projects/myapp
  infra:
    dir: ~/infrastructure
    agents_dir: ~/shared-agents  # override agent discovery path
```

### Agent Overrides

For agents that need a different working directory or extra flags:

```yaml
projects:
  myapp:
    dir: ~/projects/myapp
    overrides:
      cto-code:
        dir: ~/projects/myapp/packages/core  # launch from subdirectory
        add_dirs:
          - ~/projects/myapp/docs            # --add-dir flag
        agent: cto                           # use the cto agent definition
```

## Shell Completions

Tab-complete project and agent names:

```bash
# zsh
eval "$(claunch completions zsh)"

# bash
eval "$(claunch completions bash)"

# fish
claunch completions fish > ~/.config/fish/completions/claunch.fish
```

## Requirements

- Node.js >= 18
- [Claude Code](https://claude.ai/code) installed and available as `claude` in PATH

## License

MIT
