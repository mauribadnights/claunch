import { loadConfig, expandHome } from './config.js';
import { discoverAgents } from './discovery.js';

function generateZshCompletions() {
  return `# claunch zsh completions — auto-generated
# Add to .zshrc: eval "$(claunch completions zsh)"

_claunch() {
  local -a projects agents subcommands
  subcommands=(add remove init completions)

  if (( CURRENT == 2 )); then
    # First arg: project name or subcommand
    projects=(\${(f)"$(claunch --list-projects 2>/dev/null)"})
    _describe 'project or command' projects -- subcommands
  elif (( CURRENT == 3 )); then
    # Second arg: agent name (if first arg is a project)
    local project=\${words[2]}
    agents=(\${(f)"$(claunch --list-agents \${project} 2>/dev/null)"})
    if [[ -n "\${agents}" ]]; then
      _describe 'agent' agents
    else
      _files
    fi
  else
    _files
  fi
}

compdef _claunch claunch`;
}

function generateBashCompletions() {
  return `# claunch bash completions — auto-generated
# Add to .bashrc: eval "$(claunch completions bash)"

_claunch() {
  local cur prev
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    local projects=$(claunch --list-projects 2>/dev/null)
    COMPREPLY=( $(compgen -W "\${projects} add remove init completions" -- "\${cur}") )
  elif [[ \${COMP_CWORD} -eq 2 ]]; then
    local agents=$(claunch --list-agents "\${prev}" 2>/dev/null)
    COMPREPLY=( $(compgen -W "\${agents}" -- "\${cur}") )
  fi
}

complete -F _claunch claunch`;
}

function generateFishCompletions() {
  return `# claunch fish completions — auto-generated
# Save to ~/.config/fish/completions/claunch.fish

complete -c claunch -f
complete -c claunch -n '__fish_use_subcommand' -a '(claunch --list-projects 2>/dev/null)' -d 'Project'
complete -c claunch -n '__fish_use_subcommand' -a 'add remove init completions' -d 'Command'
complete -c claunch -n '__fish_seen_subcommand_from (claunch --list-projects 2>/dev/null)' -a '(claunch --list-agents (commandline -opc)[2] 2>/dev/null)' -d 'Agent'`;
}

/** Print project names (for completion helpers) */
function listProjects() {
  const config = loadConfig();
  return Object.keys(config.projects).join('\n');
}

/** Print agent names for a project (for completion helpers) */
function listAgents(projectName) {
  const config = loadConfig();
  const project = config.projects[projectName];
  if (!project) return '';
  const agents = discoverAgents(project);
  // Include override-only agents that may not have .md files
  const overrideNames = Object.keys(project.overrides || {});
  const allNames = new Set([...agents.map(a => a.name), ...overrideNames]);
  return [...allNames].sort().join('\n');
}

export { generateZshCompletions, generateBashCompletions, generateFishCompletions, listProjects, listAgents };
