# claunch

**Universal agent launcher for Claude Code.** Manage project-specific agents from anywhere.

[![npm version](https://img.shields.io/npm/v/@mauribadnights/claunch.svg)](https://www.npmjs.com/package/@mauribadnights/claunch)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## The Problem

As your Claude Code agent collection grows, you end up with a wall of shell aliases:

```bash
alias claude-cto="cd ~/projects/myapp && claude --agent cto"
alias claude-designer="cd ~/projects/myapp && claude --agent designer"
alias claude-devops="cd ~/infra && claude --agent devops"
# ... 15 more aliases ...
```

Each new project or agent means another alias. They pile up, break when you reorganize, and aren't portable.

## The Fix

```bash
npm install -g @mauribadnights/claunch
```

```
$ claunch
◆  claunch
│
◆  Project
│  ● myapp (3 agents)
│  ○ infra (2 agents)
│  ○ docs (1 agent)
│
◆  Agent
│  ● cto — Technical architect and engineering lead
│  ○ designer — UI/UX design advisor
│  ○ devops — Infrastructure and deployment
│
◇  Launching cto in myapp
```

One command. Interactive picker. No aliases.

## Quick Start

```bash
# Install
npm install -g @mauribadnights/claunch

# Register a project (auto-discovers agents from .claude/agents/)
claunch add myapp ~/projects/myapp
claunch add infra ~/infrastructure

# Launch interactively
claunch

# Or directly
claunch myapp cto
```

## How It Works

claunch reads agent definitions from each project's `.claude/agents/` directory — the same place Claude Code already looks for agents. No new config format to learn.

```
~/projects/myapp/
├── .claude/
│   └── agents/
│       ├── cto.md          ← claunch discovers these
│       ├── designer.md
│       └── devops.md
├── src/
└── ...
```

When you run `claunch myapp cto`, it:
1. `cd`s to `~/projects/myapp/`
2. Runs `claude --agent cto` (plus any default flags you've configured)

## Usage

```
claunch                              Interactive project/agent picker
claunch <project>                    List agents for a project
claunch <project> <agent> [args...]  Launch an agent in project context

claunch add <name> <dir>             Register a project
claunch remove <name>                Unregister a project
claunch list                         List all projects (non-interactive)
claunch init                         Create default config
claunch completions <zsh|bash|fish>  Print shell completions
```

## Configuration

Config lives at `~/.claunch/config.yaml`:

```yaml
defaults:
  claude_flags: []  # flags appended to every launch

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
