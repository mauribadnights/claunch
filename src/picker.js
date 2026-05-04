/**
 * Single-pane vertical picker — used for:
 * - Harness selection (small list, 3 items)
 * - Directory selection (when no agent step needed: codex/pi flow)
 *
 * Same key-bindings + visual style as the existing splitPanelSelect.
 */

import { fuzzyFilter } from './fuzzy.js';

const ESC = '\x1b';
const DIM = `${ESC}[2m`;
const BOLD = `${ESC}[1m`;
const RESET = `${ESC}[0m`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const CLR = `\r${ESC}[2K`;

const COLORS = {
  red: `${ESC}[31m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  blue: `${ESC}[34m`,
  purple: `${ESC}[35m`,
  cyan: `${ESC}[36m`,
  white: `${ESC}[37m`,
  orange: `${ESC}[38;5;208m`,
};

function color(name) {
  return COLORS[name] || COLORS.cyan;
}

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
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

/**
 * Single-pane fuzzy picker.
 *
 * @param {Object} opts
 * @param {string} opts.title  Short label shown in the prompt row (e.g. 'harness', 'directory')
 * @param {Array<{label, description, color, value, searchText}>} opts.items
 * @param {number} [opts.maxVisible=10]
 * @param {Object} [opts.frecency]  Score map for ranking (key -> score)
 * @param {Function} [opts.frecencyKeyFn]  Extract frecency key from item
 * @param {boolean} [opts.allowFilter=true]  Whether typing filters; false = arrow nav only
 * @returns {Promise<*|null>}  Selected item.value, or null on Esc/Ctrl-C
 */
export function verticalPick({
  title,
  items,
  maxVisible = 10,
  frecency = {},
  frecencyKeyFn = (item) => item.label,
  allowFilter = true,
}) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    const cols = Math.min(stdout.columns || 80, 140);

    let query = '';
    let cursor = 0;

    const filterOpts = { frecencyScores: frecency, frecencyKeyFn };
    let filtered = fuzzyFilter(items, query, filterOpts);

    const frameHeight = 1 + maxVisible + 1; // prompt + list + status
    let initialized = false;

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdout.write(HIDE_CURSOR);

    function render() {
      if (initialized) {
        stdout.write(`\r${ESC}[${frameHeight - 1}A`);
      } else {
        stdout.write('\n'.repeat(frameHeight - 1));
        stdout.write(`\r${ESC}[${frameHeight - 1}A`);
        initialized = true;
      }

      for (let row = 0; row < frameHeight; row++) {
        const line = renderLine(row);
        stdout.write(`${CLR}${padOrTruncate(line, cols)}`);
        if (row < frameHeight - 1) stdout.write('\n');
      }
    }

    function renderLine(row) {
      if (row === 0) {
        const placeholder = (allowFilter && !query) ? `${DIM}type to filter...${RESET}` : '';
        const queryPart = allowFilter ? `${DIM}>${RESET} ${query}${placeholder}` : '';
        return `${BOLD}${title}${RESET} ${queryPart}`;
      }
      const idx = row - 1;
      if (idx < maxVisible) {
        if (idx < filtered.length) {
          const item = filtered[idx];
          const sel = idx === cursor;
          const ptr = sel ? `${color(item.color || 'cyan')}>${RESET} ` : '  ';
          const lbl = sel ? `${BOLD}${item.label}${RESET}` : item.label;
          const desc = item.description ? ` ${DIM}${item.description}${RESET}` : '';
          return `${ptr}${lbl}${desc}`;
        }
        return '';
      }
      const status = query
        ? `${filtered.length}/${items.length}`
        : `${items.length}`;
      const hint = allowFilter ? ' | type to filter' : '';
      return `${DIM}${status}${hint} | enter to select | esc to cancel${RESET}`;
    }

    function cleanup() {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeAllListeners('data');
      stdout.write(SHOW_CURSOR + '\n');
    }

    function handleKey(key) {
      if (key === '\x03') { cleanup(); resolve(null); return; }
      if (key === '\x1b') { cleanup(); resolve(null); return; }

      if (key === '\r' || key === '\n') {
        const item = filtered[cursor];
        cleanup();
        resolve(item ? item.value : null);
        return;
      }

      if (key === '\x7f' || key === '\b') {
        if (allowFilter && query.length > 0) {
          query = query.slice(0, -1);
          cursor = 0;
          filtered = fuzzyFilter(items, query, filterOpts);
          render();
        }
        return;
      }

      if (key === `${ESC}[A`) {
        cursor = Math.max(0, cursor - 1);
        render();
        return;
      }
      if (key === `${ESC}[B`) {
        cursor = Math.min(Math.max(filtered.length - 1, 0), cursor + 1);
        render();
        return;
      }
      if (key === '\t') {
        cursor = (cursor + 1) % Math.max(filtered.length, 1);
        render();
        return;
      }

      if (allowFilter && key.length === 1 && key >= ' ') {
        query += key;
        cursor = 0;
        filtered = fuzzyFilter(items, query, filterOpts);
        render();
      }
    }

    stdin.on('data', handleKey);
    render();
  });
}
