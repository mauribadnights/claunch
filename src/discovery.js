import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { expandHome } from './config.js';

/**
 * Discover agents in a project's agents directory.
 * Returns array of { name, file, description, color }
 */
function discoverAgents(projectConfig) {
  const dir = expandHome(projectConfig.dir);
  const agentsDir = projectConfig.agents_dir
    ? expandHome(projectConfig.agents_dir)
    : join(dir, '.claude', 'agents');

  if (!existsSync(agentsDir)) return [];

  const files = readdirSync(agentsDir).filter(f => f.endsWith('.md'));
  return files.map(f => {
    const filePath = join(agentsDir, f);
    const name = basename(f, '.md');
    const meta = parseFrontmatter(filePath);
    return { name, file: filePath, ...meta };
  });
}

/** Extract description and color from agent frontmatter */
function parseFrontmatter(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return { description: '', color: null };

    const fm = match[1];
    const descMatch = fm.match(/description:\s*(.+)/);
    const colorMatch = fm.match(/color:\s*(\w+)/);

    return {
      description: descMatch ? descMatch[1].trim() : '',
      color: colorMatch ? colorMatch[1].trim() : null,
    };
  } catch {
    return { description: '', color: null };
  }
}

/**
 * Resolve the effective config for a specific agent invocation.
 * Merges project-level config with agent-level overrides.
 * Returns { dir, agent, addDirs, extraFlags }
 */
function resolveAgent(projectConfig, agentName) {
  const override = projectConfig.overrides?.[agentName];
  const dir = expandHome(override?.dir || projectConfig.dir);
  const addDirs = (override?.add_dirs || []).map(expandHome);
  const extraFlags = override?.extra_flags || [];
  const agent = override?.agent || agentName;

  return { dir, agent, addDirs, extraFlags };
}

export { discoverAgents, resolveAgent };
