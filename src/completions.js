import { loadConfig, expandHome } from './config.js';
import { discoverAgents } from './discovery.js';
import { HARNESSES } from './harness.js';

function generateZshCompletions() {
  return `# claunch zsh completions — auto-generated
# Add to .zshrc: eval "$(claunch completions zsh)"

_claunch() {
  local -a projects agents harnesses subcommands
  subcommands=(add remove init completions audit update upgrade scan list)
  harnesses=(\${(f)"$(claunch --list-harnesses 2>/dev/null)"})

  if (( CURRENT == 2 )); then
    projects=(\${(f)"$(claunch --list-projects 2>/dev/null)"})
    _alternative 'harness:harness:($harnesses)' 'project:project:($projects)' 'subcommand:subcommand:($subcommands)'
  elif (( CURRENT == 3 )); then
    local first=\${words[2]}
    if [[ " \${harnesses[*]} " == *" \${first} "* ]]; then
      projects=(\${(f)"$(claunch --list-projects 2>/dev/null)"})
      _describe 'project' projects
    elif [[ "\${first}" == "audit" ]]; then
      _describe 'harness' harnesses
    else
      agents=(\${(f)"$(claunch --list-agents \${first} 2>/dev/null)"})
      if [[ -n "\${agents}" ]]; then
        _describe 'agent' agents
      else
        _files
      fi
    fi
  elif (( CURRENT == 4 )); then
    local first=\${words[2]}
    local second=\${words[3]}
    if [[ " \${harnesses[*]} " == *" \${first} "* ]] && [[ "\${first}" == "claude" ]]; then
      agents=(\${(f)"$(claunch --list-agents \${second} 2>/dev/null)"})
      _describe 'agent' agents
    else
      _files
    fi
  else
    _files
  fi
}

compdef _claunch claunch c`;
}

function generateBashCompletions() {
  return `# claunch bash completions — auto-generated
# Add to .bashrc: eval "$(claunch completions bash)"

_claunch() {
  local cur prev
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  local harnesses="$(claunch --list-harnesses 2>/dev/null)"
  local projects="$(claunch --list-projects 2>/dev/null)"

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "\${harnesses} \${projects} add remove init completions audit update upgrade scan list" -- "\${cur}") )
  elif [[ \${COMP_CWORD} -eq 2 ]]; then
    if [[ " \${harnesses} " == *" \${prev} "* ]]; then
      COMPREPLY=( $(compgen -W "\${projects}" -- "\${cur}") )
    elif [[ "\${prev}" == "audit" ]]; then
      COMPREPLY=( $(compgen -W "\${harnesses}" -- "\${cur}") )
    else
      local agents=$(claunch --list-agents "\${prev}" 2>/dev/null)
      COMPREPLY=( $(compgen -W "\${agents}" -- "\${cur}") )
    fi
  elif [[ \${COMP_CWORD} -eq 3 ]]; then
    local first="\${COMP_WORDS[1]}"
    if [[ "\${first}" == "claude" ]]; then
      local agents=$(claunch --list-agents "\${prev}" 2>/dev/null)
      COMPREPLY=( $(compgen -W "\${agents}" -- "\${cur}") )
    fi
  fi
}

complete -F _claunch claunch
complete -F _claunch c`;
}

function generateFishCompletions() {
  return `# claunch fish completions — auto-generated
# Save to ~/.config/fish/completions/claunch.fish

complete -c claunch -f
complete -c claunch -n '__fish_use_subcommand' -a '(claunch --list-harnesses 2>/dev/null)' -d 'Harness'
complete -c claunch -n '__fish_use_subcommand' -a '(claunch --list-projects 2>/dev/null)' -d 'Project'
complete -c claunch -n '__fish_use_subcommand' -a 'add remove init completions audit update scan list' -d 'Command'
complete -c claunch -n '__fish_seen_subcommand_from (claunch --list-harnesses 2>/dev/null)' -a '(claunch --list-projects 2>/dev/null)' -d 'Project'
complete -c claunch -n '__fish_seen_subcommand_from audit' -a '(claunch --list-harnesses 2>/dev/null)' -d 'Harness'

complete -c c -f
complete -c c -n '__fish_use_subcommand' -a '(claunch --list-harnesses 2>/dev/null)' -d 'Harness'
complete -c c -n '__fish_use_subcommand' -a '(claunch --list-projects 2>/dev/null)' -d 'Project'`;
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
  const overrideNames = Object.keys(project.overrides || {});
  const allNames = new Set([...agents.map(a => a.name), ...overrideNames]);
  return [...allNames].sort().join('\n');
}

export { generateZshCompletions, generateBashCompletions, generateFishCompletions, listProjects, listAgents };
