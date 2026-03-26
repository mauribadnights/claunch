import { fuzzyFilter } from './fuzzy.js';

const ESC = '\x1b';
const DIM = `${ESC}[2m`;
const BOLD = `${ESC}[1m`;
const RESET = `${ESC}[0m`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const CLR = `\r${ESC}[2K`;

// Color name -> ANSI code
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

// ============================================================
// Pixel grid -> block character renderer
// Each 2x2 pixel cell maps to one Unicode block character.
// Index = UL*8 + UR*4 + LL*2 + LR
// ============================================================
const BLOCKS = ' \u2597\u2596\u2584\u259D\u2590\u259E\u259F\u2598\u259A\u258C\u2599\u2580\u259C\u259B\u2588';
//              0  ▗1   ▖2   ▄3   ▝4   ▐5   ▞6   ▟7   ▘8   ▚9   ▌10  ▙11  ▀12  ▜13  ▛14  █15

function gridToLines(grid) {
  const lines = [];
  for (let y = 0; y < grid.length; y += 2) {
    const top = grid[y];
    const bot = grid[y + 1] || new Array(top.length).fill(0);
    let line = '';
    for (let x = 0; x < top.length; x += 2) {
      const ul = top[x] || 0;
      const ur = top[x + 1] || 0;
      const ll = bot[x] || 0;
      const lr = bot[x + 1] || 0;
      line += BLOCKS[ul * 8 + ur * 4 + ll * 2 + lr];
    }
    lines.push(line);
  }
  return lines;
}

// ============================================================
// Logo as pixel grid: 6 rows x 20 columns = 3 char lines x 10 chars
//
//   . . . # # # # # # # # # # # # . . . . .   <- head top
//   . . . # # . # # # # # # . # # . . . . .   <- head bottom
//   . # # # # # # # # # # # # # # # # . . .   <- body top
//   . . . # # # # # # # # # # # # . . . . .   <- body bottom
//   . . . . # . # . . . . # . # . . . . . .   <- feet top
//   . . . . . . . . . . . . . . . . . . . .   <- feet bottom
//
// Renders to:
//    ▐▛███▜▌
//   ▝▜█████▛▘
//     ▘▘ ▝▝
// ============================================================
const IDLE_GRID = [
  [0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0],
  [0,0,0,1,1,0,1,1,1,1,1,1,0,1,1,0,0,0,0,0],
  [0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0],
  [0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0],
  [0,0,0,0,1,0,1,0,0,0,0,1,0,1,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
];

// Eye states
const EYE_CLOSED = 0, EYE_LEFT = 1, EYE_RIGHT = 2;

// Wave pixel modifications per frame: [row, col, value]
// Arm at pixel [2][16] is always 1 (connected to body).
// Wave extends upward through [1][16] and [0][16-17].
// Wave only extends into y1 (body-head boundary), never up to y0
const WAVE_MODS = [
  [[1, 16, 1]],                           // 0: arm raises to head level
  [[1, 16, 1], [1, 17, 1]],               // 1: hand opens
  [[1, 16, 1]],                           // 2: hand closes
  [[1, 16, 1], [1, 17, 1]],               // 3: hand opens again
  [[1, 16, 1]],                           // 4: hand closes
  [],                                     // 5: arm down
];

// Prime intervals (ms) -- never sync the same way twice
const P_EYE = 3001;
const P_ARM = 2003;
const P_GREET_MIN = 7013;
const P_GREET_MAX = 13007;

/**
 * Build logo from independent animation states.
 * Copies the idle grid, applies mutations, converts to block chars.
 */
function buildLogo(eyeState, armOut, waveFrame) {
  // Deep copy
  const g = IDLE_GRID.map(r => [...r]);

  // Eye: move the two "pupil" gaps on y1 (pixels 5 and 12 are the eye holes)
  // Shift them by toggling adjacent pixels
  if (eyeState === EYE_LEFT) {
    g[1][5] = 1; g[1][4] = 0;   // left eye: fill original, open one left
    g[1][12] = 1; g[1][11] = 0; // right eye: fill original, open one left
  } else if (eyeState === EYE_RIGHT) {
    g[1][5] = 1; g[1][6] = 0;   // left eye: fill original, open one right
    g[1][12] = 1; g[1][13] = 0; // right eye: fill original, open one right
  }

  // Arm only moves during wave, stays still at idle

  // Wave: apply pixel modifications
  if (waveFrame >= 0 && waveFrame < WAVE_MODS.length) {
    for (const [y, x, v] of WAVE_MODS[waveFrame]) {
      g[y][x] = v;
    }
  }

  return gridToLines(g);
}

function shiftRow(row, offset) {
  const shifted = new Array(row.length).fill(0);
  for (let i = 0; i < row.length; i++) {
    const src = i - offset;
    if (src >= 0 && src < row.length) shifted[i] = row[src];
  }
  return shifted;
}

const GREETINGS = [
  'pick me!', 'pick me!', 'me me me!', 'choose me!', 'over here!',
  'this one!', 'right here!', 'good choice!', "i'm the best!",
  "you won't regret it!", 'trust me!', 'obviously me!', 'no brainer!',
  "i'm ready!", "let's go!", 'pick pick pick!', 'hey, me!',
  "i'm your agent!", 'best agent here!', 'the one and only!',
  'psst!', 'sup!', 'boo!', 'yo!', 'hey!', 'hi!', 'salutations!',
];

/**
 * Split-panel fuzzy selector with animated Claude logo.
 *
 * Phase 1 (agent): Left = fuzzy list, Right = logo + description
 * Phase 2 (directory): Left = frozen agent, Right = fuzzy list
 */
function splitPanelSelect({ agentItems, dirItemsFn, maxVisible = 13, agentFrecency = {}, dirFrecency = {} }) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    const cols = Math.min(process.stdout.columns || 80, 140);
    const leftWidth = Math.floor(cols * 0.42);
    const rightWidth = cols - leftWidth - 3;

    const agentFrecOpts = {
      frecencyScores: agentFrecency,
      frecencyKeyFn: (item) => item.label,
    };
    const dirFrecOpts = {
      frecencyScores: dirFrecency,
      frecencyKeyFn: (item) => item.value?.dir || '',
    };

    let phase = 'agent';
    let query = '';
    let cursor = 0;
    let filtered = fuzzyFilter(agentItems, query, agentFrecOpts);
    let selectedAgent = null;

    let dirItems = [];
    let dirQuery = '';
    let dirCursor = 0;
    let dirFiltered = [];

    // Independent animation states
    let eyeState = EYE_CLOSED;
    let armOut = false;
    let waveFrame = -1;
    let greeting = null;

    // Timer handles
    let eyeTimer = null;
    let eyeSeqTimer = null;
    let armTimer = null;
    let greetTimer = null;
    let waveTimer = null;

    const frameHeight = 1 + maxVisible + 1;
    let initialized = false;

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdout.write(HIDE_CURSOR);

    function startAnimation() {
      // Eyes: glance on prime interval
      eyeTimer = setInterval(() => {
        const sequences = [
          [EYE_LEFT],
          [EYE_RIGHT],
          [EYE_LEFT, EYE_RIGHT],
          [EYE_RIGHT, EYE_LEFT],
          [EYE_LEFT, EYE_CLOSED, EYE_RIGHT],
        ];
        const seq = sequences[Math.floor(Math.random() * sequences.length)];
        let step = 0;
        eyeState = seq[0];
        render();

        eyeSeqTimer = setInterval(() => {
          step++;
          if (step >= seq.length) {
            clearInterval(eyeSeqTimer);
            eyeSeqTimer = null;
            setTimeout(() => { eyeState = EYE_CLOSED; render(); }, 601);
            return;
          }
          eyeState = seq[step];
          render();
        }, 409);
      }, P_EYE);

      // Greeting + wave
      scheduleGreeting();
    }

    function scheduleGreeting() {
      const delay = P_GREET_MIN + Math.random() * (P_GREET_MAX - P_GREET_MIN);
      greetTimer = setTimeout(() => {
        greeting = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
        let step = 0;
        const seq = [0, 1, 2, 3, 4, 5];
        waveFrame = seq[0];
        render();

        waveTimer = setInterval(() => {
          step++;
          if (step >= seq.length) {
            clearInterval(waveTimer);
            waveTimer = null;
            waveFrame = -1;
            greeting = null;
            render();
            if (phase === 'agent') scheduleGreeting();
            return;
          }
          if (step === seq.length - 1) greeting = null;
          waveFrame = seq[step];
          render();
        }, 307);
      }, delay);
    }

    function stopAnimation() {
      if (eyeTimer) clearInterval(eyeTimer);
      if (eyeSeqTimer) clearInterval(eyeSeqTimer);
      if (armTimer) clearInterval(armTimer);
      if (greetTimer) clearTimeout(greetTimer);
      if (waveTimer) clearInterval(waveTimer);
      eyeTimer = eyeSeqTimer = armTimer = greetTimer = waveTimer = null;
      eyeState = EYE_CLOSED;
      armOut = false;
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

      const hoveredAgent = phase === 'agent' ? filtered[cursor] : null;

      for (let row = 0; row < frameHeight; row++) {
        const leftContent = renderLeftLine(row, phase, visible, currentQuery, currentCursor, maxVisible, totalCount, filteredCount, selectedAgent);
        const rightContent = renderRightLine(row, phase, hoveredAgent, dirFiltered, dirQuery, dirCursor, maxVisible, dirItems.length, dirFiltered.length, rightWidth);

        const left = padOrTruncate(leftContent, leftWidth);
        const sep = `${DIM}|${RESET}`;
        const right = padOrTruncate(rightContent, rightWidth);

        stdout.write(`${CLR}${left} ${sep} ${right}`);
        if (row < frameHeight - 1) stdout.write('\n');
      }
    }

    function renderLeftLine(row, phase, visible, query, cursor, maxVisible, total, filteredCount, selectedAgent) {
      if (phase === 'agent') {
        if (row === 0) {
          const placeholder = query ? '' : `${DIM}type to filter...${RESET}`;
          return `${BOLD}agent${RESET} ${DIM}>${RESET} ${query}${placeholder}`;
        }
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
        const status = query ? `${filteredCount}/${total}` : `${total}`;
        return `${DIM}${status} | type to filter | enter${RESET}`;
      } else {
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
      const logoLines = buildLogo(eyeState, armOut, waveFrame);

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
      if (row === 0) {
        const placeholder = query ? '' : `${DIM}type to filter...${RESET}`;
        return `${BOLD}directory${RESET} ${DIM}>${RESET} ${query}${placeholder}`;
      }
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
      const status = query ? `${filteredCount}/${total}` : `${total}`;
      return `${DIM}${status} | type to filter | enter${RESET}`;
    }

    function handleKey(key) {
      if (key === '\x03') { cleanup(); resolve(null); return; }

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

      if (key === '\r' || key === '\n') {
        if (phase === 'agent') {
          const agent = filtered[cursor];
          if (!agent) return;
          selectedAgent = agent;
          stopAnimation();

          dirItems = dirItemsFn(agent.value);
          dirQuery = '';
          dirCursor = 0;
          dirFiltered = fuzzyFilter(dirItems, dirQuery, dirFrecOpts);

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

      if (key === `${ESC}[A`) {
        if (phase === 'agent') cursor = Math.max(0, cursor - 1);
        else dirCursor = Math.max(0, dirCursor - 1);
        render();
        return;
      }

      if (key === `${ESC}[B`) {
        if (phase === 'agent') cursor = Math.min(Math.max(filtered.length - 1, 0), cursor + 1);
        else dirCursor = Math.min(Math.max(dirFiltered.length - 1, 0), dirCursor + 1);
        render();
        return;
      }

      if (key === '\t') {
        if (phase === 'agent') cursor = (cursor + 1) % Math.max(filtered.length, 1);
        else dirCursor = (dirCursor + 1) % Math.max(dirFiltered.length, 1);
        render();
        return;
      }

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

function padOrTruncate(str, width) {
  const visible = stripAnsi(str);
  if (visible.length >= width) {
    let visCount = 0;
    let i = 0;
    while (i < str.length && visCount < width - 1) {
      if (str[i] === '\x1b') {
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

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

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
