import { fuzzyFilter } from './fuzzy.js';

const ESC = '\x1b';
const DIM = `${ESC}[2m`;
const BOLD = `${ESC}[1m`;
const RESET = `${ESC}[0m`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const CLR = `\r${ESC}[2K`;

// Color name → ANSI code
const COLORS = {
  red: `${ESC}[31m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  blue: `${ESC}[34m`,
  purple: `${ESC}[35m`,
  magenta: `${ESC}[35m`,
  cyan: `${ESC}[36m`,
  white: `${ESC}[37m`,
  orange: `${ESC}[38;5;208m`,
};

// Animation frames: idle + 3 wave frames (right arm lifts and waves)
const LOGO_IDLE = [
  ' ▐▛███▜▌ ',
  '▝▜█████▛▘',
  '  ▘▘ ▝▝  ',
];

const LOGO_WAVE = [
  [  // frame 0: arm lifts off
    ' ▐▛███▜▌▘',
    '▝▜█████▛ ',
    '  ▘▘ ▝▝  ',
  ],
  [  // frame 1: arm up
    ' ▐▛███▜▌▝',
    '▝▜█████▛ ',
    '  ▘▘ ▝▝  ',
  ],
  [  // frame 2: arm tilt
    ' ▐▛███▜▌▘',
    '▝▜█████▛ ',
    '  ▘▘ ▝▝  ',
  ],
];

const GREETINGS = ['hi!', 'hey!', 'ready!', "let's go!", 'pick me!', 'hello!', 'yo!'];

/**
 * Split-panel fuzzy selector with animated Claude logo.
 *
 * Phase 1 (agent): Left = fuzzy list, Right = logo + description
 * Phase 2 (directory): Left = frozen agent, Right = fuzzy list
 *
 * @param {Object} opts
 * @param {Array} opts.agentItems - agent items with { label, tag, description, color, value, searchText }
 * @param {Array} opts.dirItemsFn - function(selectedAgent) => directory items
 * @param {number} [opts.maxVisible=13]
 * @returns {Promise<{agent, dir}|null>}
 */
function splitPanelSelect({ agentItems, dirItemsFn, maxVisible = 13, agentFrecency = {}, dirFrecency = {} }) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    const cols = Math.min(process.stdout.columns || 80, 140);
    const leftWidth = Math.floor(cols * 0.42);
    const rightWidth = cols - leftWidth - 3; // 3 for separator

    const agentFrecOpts = {
      frecencyScores: agentFrecency,
      frecencyKeyFn: (item) => item.label,
    };
    const dirFrecOpts = {
      frecencyScores: dirFrecency,
      frecencyKeyFn: (item) => item.value?.dir || '',
    };

    let phase = 'agent'; // 'agent' | 'directory'
    let query = '';
    let cursor = 0;
    let filtered = fuzzyFilter(agentItems, query, agentFrecOpts);
    let selectedAgent = null;

    // Directory state
    let dirItems = [];
    let dirQuery = '';
    let dirCursor = 0;
    let dirFiltered = [];

    // Animation state
    let greeting = null;
    let waveFrame = -1;     // -1 = idle, 0-2 = wave frames
    let greetingTimeout = null;
    let waveInterval = null;

    const frameHeight = 1 + maxVisible + 1; // header + items + status
    let initialized = false;

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdout.write(HIDE_CURSOR);

    function startAnimation() {
      scheduleGreeting();
    }

    function scheduleGreeting() {
      const delay = 4000 + Math.random() * 6000;
      greetingTimeout = setTimeout(() => {
        greeting = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];

        // Play wave animation: cycle through frames then back to idle
        let waveStep = 0;
        const waveSequence = [0, 1, 2, 1, 0]; // lift, up, tilt, up, lift
        waveFrame = waveSequence[0];
        render();

        waveInterval = setInterval(() => {
          waveStep++;
          if (waveStep >= waveSequence.length) {
            // Wave done, return to idle
            clearInterval(waveInterval);
            waveInterval = null;
            waveFrame = -1;
            greeting = null;
            render();
            if (phase === 'agent') scheduleGreeting();
            return;
          }
          waveFrame = waveSequence[waveStep];
          render();
        }, 300);
      }, delay);
    }

    function stopAnimation() {
      if (waveInterval) clearInterval(waveInterval);
      if (greetingTimeout) clearTimeout(greetingTimeout);
      waveInterval = null;
      greetingTimeout = null;
      waveFrame = -1;
      greeting = null;
    }

    function getColor(colorName) {
      return COLORS[colorName] || COLORS.cyan;
    }

    function render() {
      if (initialized) {
        stdout.write(`\r${ESC}[${frameHeight - 1}A`);
      } else {
        stdout.write('\n'.repeat(frameHeight - 1));
        stdout.write(`\r${ESC}[${frameHeight - 1}A`);
        initialized = true;
      }

      const currentItems = phase === 'agent' ? filtered : dirFiltered;
      const currentQuery = phase === 'agent' ? query : dirQuery;
      const currentCursor = phase === 'agent' ? cursor : dirCursor;
      const visible = currentItems.slice(0, maxVisible);
      const totalCount = phase === 'agent' ? agentItems.length : dirItems.length;
      const filteredCount = currentItems.length;

      // Get selected agent info for right panel
      const hoveredAgent = phase === 'agent' ? filtered[cursor] : null;

      for (let row = 0; row < frameHeight; row++) {
        const leftContent = renderLeftLine(row, phase, visible, currentQuery, currentCursor, maxVisible, totalCount, filteredCount, selectedAgent);
        const rightContent = renderRightLine(row, phase, hoveredAgent, dirFiltered, dirQuery, dirCursor, maxVisible, dirItems.length, dirFiltered.length, rightWidth);

        // Compose line: left | separator | right
        const left = padOrTruncate(leftContent, leftWidth);
        const sep = row === 0 ? `${DIM}|${RESET}` : `${DIM}|${RESET}`;
        const right = padOrTruncate(rightContent, rightWidth);

        stdout.write(`${CLR}${left} ${sep} ${right}`);
        if (row < frameHeight - 1) stdout.write('\n');
      }
    }

    function renderLeftLine(row, phase, visible, query, cursor, maxVisible, total, filteredCount, selectedAgent) {
      if (phase === 'agent') {
        // Header
        if (row === 0) {
          const placeholder = query ? '' : `${DIM}type to filter...${RESET}`;
          return `${BOLD}agent${RESET} ${DIM}>${RESET} ${query}${placeholder}`;
        }
        // Items
        const idx = row - 1;
        if (idx < maxVisible) {
          if (idx < visible.length) {
            const item = visible[idx];
            const sel = idx === cursor;
            const ptr = sel ? `${getColor(item.color || 'cyan')}>${RESET} ` : '  ';
            const lbl = sel ? `${BOLD}${item.label}${RESET}` : item.label;
            const tag = item.tag ? `${DIM}[${item.tag}]${RESET}` : '';
            return `${ptr}${lbl} ${tag}`;
          }
          return '';
        }
        // Status
        const status = query ? `${filteredCount}/${total}` : `${total}`;
        return `${DIM}${status} | type to filter | enter${RESET}`;
      } else {
        // Frozen agent display
        if (row === 0) {
          const agentLabel = selectedAgent?.label || '';
          const tag = selectedAgent?.tag ? ` ${DIM}[${selectedAgent.tag}]${RESET}` : '';
          return `${BOLD}agent:${RESET} ${agentLabel}${tag}`;
        }
        if (row === 1) return '';
        if (row === 2) {
          const desc = selectedAgent?.description || '';
          return `${DIM}${desc}${RESET}`;
        }
        return '';
      }
    }

    function renderRightLine(row, phase, hoveredAgent, dirFiltered, dirQuery, dirCursor, maxVisible, dirTotal, dirFilteredCount, width) {
      if (phase === 'agent') {
        return renderAgentDetail(row, hoveredAgent, width);
      } else {
        return renderDirList(row, dirFiltered, dirQuery, dirCursor, maxVisible, dirTotal, dirFilteredCount);
      }
    }

    function renderAgentDetail(row, agent, width) {
      if (!agent) return '';

      const color = getColor(agent.color || 'cyan');
      const logoLines = waveFrame >= 0 ? LOGO_WAVE[waveFrame] : LOGO_IDLE;

      // Layout:
      // row 0: (empty / padding)
      // row 1: logo line 0 + greeting
      // row 2: logo line 1
      // row 3: logo line 2
      // row 4: (empty)
      // row 5: agent name (bold)
      // row 6+: description wrapped

      const logoOffset = 1;
      const descOffset = 5;

      if (row >= logoOffset && row < logoOffset + logoLines.length) {
        const logoIdx = row - logoOffset;
        const logoLine = logoLines[logoIdx];
        let line = `  ${color}${logoLine}${RESET}`;
        if (logoIdx === 0 && greeting) {
          line += ` ${color}${greeting}${RESET}`;
        }
        return line;
      }

      if (row === descOffset) {
        return `  ${BOLD}${color}${agent.label}${RESET}`;
      }

      if (row > descOffset && agent.description) {
        const descLines = wrapText(agent.description, width - 4);
        const descIdx = row - descOffset - 1;
        if (descIdx < descLines.length) {
          return `  ${DIM}${descLines[descIdx]}${RESET}`;
        }
      }

      return '';
    }

    function renderDirList(row, visible, query, cursor, maxVisible, total, filteredCount) {
      // Header
      if (row === 0) {
        const placeholder = query ? '' : `${DIM}type to filter...${RESET}`;
        return `${BOLD}directory${RESET} ${DIM}>${RESET} ${query}${placeholder}`;
      }
      // Items
      const idx = row - 1;
      if (idx < maxVisible) {
        const items = visible.slice(0, maxVisible);
        if (idx < items.length) {
          const item = items[idx];
          const sel = idx === cursor;
          const ptr = sel ? `${COLORS.cyan}>${RESET} ` : '  ';
          const lbl = sel ? `${BOLD}${item.label}${RESET}` : item.label;
          return `${ptr}${lbl}`;
        }
        return '';
      }
      // Status
      const status = query ? `${filteredCount}/${total}` : `${total}`;
      return `${DIM}${status} | type to filter | enter${RESET}`;
    }

    function handleKey(key) {
      // Ctrl+C
      if (key === '\x03') {
        cleanup();
        resolve(null);
        return;
      }

      // Escape: go back to agent phase, or cancel
      if (key === '\x1b') {
        if (phase === 'directory') {
          phase = 'agent';
          selectedAgent = null;
          startAnimation();
          render();
          return;
        }
        cleanup();
        resolve(null);
        return;
      }

      // Enter
      if (key === '\r' || key === '\n') {
        if (phase === 'agent') {
          const agent = filtered[cursor];
          if (!agent) return;
          selectedAgent = agent;
          stopAnimation();

          // Build directory items
          dirItems = dirItemsFn(agent.value);
          dirQuery = '';
          dirCursor = 0;
          dirFiltered = fuzzyFilter(dirItems, dirQuery, dirFrecOpts);

          // If only one dir, skip picker
          if (dirItems.length <= 1) {
            const dir = dirItems[0]?.value?.dir || null;
            cleanup();
            resolve({ agent: agent.value, dir });
            return;
          }

          phase = 'directory';
          render();
          return;
        } else {
          const dir = dirFiltered[dirCursor];
          cleanup();
          resolve({ agent: selectedAgent.value, dir: dir?.value?.dir || null });
          return;
        }
      }

      // Backspace
      if (key === '\x7f' || key === '\b') {
        if (phase === 'agent') {
          if (query.length > 0) {
            query = query.slice(0, -1);
            cursor = 0;
            filtered = fuzzyFilter(agentItems, query, agentFrecOpts);
          }
        } else {
          if (dirQuery.length > 0) {
            dirQuery = dirQuery.slice(0, -1);
            dirCursor = 0;
            dirFiltered = fuzzyFilter(dirItems, dirQuery, dirFrecOpts);
          }
        }
        render();
        return;
      }

      // Arrow up
      if (key === `${ESC}[A`) {
        if (phase === 'agent') {
          cursor = Math.max(0, cursor - 1);
        } else {
          dirCursor = Math.max(0, dirCursor - 1);
        }
        render();
        return;
      }

      // Arrow down
      if (key === `${ESC}[B`) {
        if (phase === 'agent') {
          cursor = Math.min(Math.max(filtered.length - 1, 0), cursor + 1);
        } else {
          dirCursor = Math.min(Math.max(dirFiltered.length - 1, 0), dirCursor + 1);
        }
        render();
        return;
      }

      // Tab
      if (key === '\t') {
        if (phase === 'agent') {
          cursor = (cursor + 1) % Math.max(filtered.length, 1);
        } else {
          dirCursor = (dirCursor + 1) % Math.max(dirFiltered.length, 1);
        }
        render();
        return;
      }

      // Printable character
      if (key.length === 1 && key >= ' ') {
        if (phase === 'agent') {
          query += key;
          cursor = 0;
          filtered = fuzzyFilter(agentItems, query, agentFrecOpts);
        } else {
          dirQuery += key;
          dirCursor = 0;
          dirFiltered = fuzzyFilter(dirItems, dirQuery, dirFrecOpts);
        }
        render();
        return;
      }
    }

    function cleanup() {
      stopAnimation();
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeAllListeners('data');
      stdout.write(SHOW_CURSOR + '\n');
    }

    stdin.on('data', handleKey);
    startAnimation();
    render();
  });
}

/** Pad or truncate a string (accounting for ANSI codes) to fit width */
function padOrTruncate(str, width) {
  const visible = stripAnsi(str);
  if (visible.length >= width) {
    // Truncate: find the position in the original string
    let visCount = 0;
    let i = 0;
    while (i < str.length && visCount < width - 1) {
      if (str[i] === '\x1b') {
        // Skip ANSI sequence
        while (i < str.length && str[i] !== 'm') i++;
        i++;
        continue;
      }
      visCount++;
      i++;
    }
    return str.slice(0, i) + RESET;
  }
  return str + ' '.repeat(width - visible.length);
}

/** Strip ANSI escape codes for length calculation */
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Wrap text to fit within width */
function wrapText(text, width) {
  if (width <= 0) return [text];
  const words = text.split(' ');
  const lines = [];
  let current = '';

  for (const word of words) {
    if (current.length + word.length + 1 > width) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export { splitPanelSelect };
