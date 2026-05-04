/**
 * Drift detector for harness CLI surfaces.
 *
 * Goal: surface a warning when a harness gains a new mode/flag that claunch
 * doesn't expose, so the launcher abstraction never silently leaks.
 *
 * Mechanism:
 * 1. Cache the harness's `--help` output to disk + sha256 of it.
 * 2. Compare cached sha to the "acknowledged" sha stored in config.yaml.
 * 3. If they differ → drift; surface diff + leak-token hits to stderr.
 * 4. Cache is refreshed asynchronously when older than `CACHE_TTL_HOURS` so
 *    drift detection costs ~5ms on every launch (file read + hash compare).
 *
 * First-run behavior: empty cache + empty config → silent baseline establishment.
 * Binary missing: silent no-op (the launcher's ENOENT handles user feedback).
 */

import { spawn, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  existsSync,
  statSync,
} from 'fs';
import { join } from 'path';
import { getConfigDir, loadConfig, saveConfig } from './config.js';
import { HARNESSES } from './harness.js';

const CACHE_TTL_HOURS = 24;

function getCacheDir() {
  return join(getConfigDir(), 'help-cache');
}

function ensureCacheDir() {
  const dir = getCacheDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function helpTextPath(name) {
  return join(getCacheDir(), `${name}.txt`);
}

function helpMetaPath(name) {
  return join(getCacheDir(), `${name}.meta.yaml`);
}

function sha(text) {
  return createHash('sha256').update(text || '').digest('hex');
}

function readCachedHelp(name) {
  const path = helpTextPath(name);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Atomic-rename write so concurrent claunch instances racing the async
 * refresh path can't corrupt each other's cache file. Per-process unique
 * tmp file → rename = single inode swap on the same filesystem.
 */
function writeCachedHelp(name, text) {
  ensureCacheDir();
  const final = helpTextPath(name);
  const tmp = `${final}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, final);
}

function cacheAgeHours(name) {
  const path = helpTextPath(name);
  if (!existsSync(path)) return Infinity;
  try {
    const mtime = statSync(path).mtime.getTime();
    return (Date.now() - mtime) / (1000 * 60 * 60);
  } catch {
    return Infinity;
  }
}

/**
 * Synchronously fingerprint a harness binary by running its fingerprint args
 * and capturing stdout+stderr. Returns null if the binary is missing or
 * outright errors (ENOENT, signal kill, timeout). Non-zero exit codes are
 * accepted as long as we got SOME output — many CLIs exit 1 on `--help`.
 */
function fingerprintSync(harness) {
  const result = spawnSync(harness.bin, harness.fingerprint_args, {
    encoding: 'utf8',
    timeout: 10000,
  });
  if (result.error) return null;
  const text = (result.stdout || '') + (result.stderr || '');
  if (!text) return null;
  return text;
}

/**
 * Asynchronously refresh the cached help text for a harness. Detached and
 * unref'd so it never blocks the parent process. Capped at 10 s — if the
 * harness's `--help` hangs (license check, network call), the child is killed
 * and the cache stays whatever it was.
 *
 * Non-zero exit is accepted as long as we got output (mirroring fingerprintSync).
 */
function refreshCacheAsync(harness) {
  ensureCacheDir();
  try {
    const child = spawn(harness.bin, harness.fingerprint_args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      timeout: 10000,
    });

    let out = '';
    let err = '';
    let killed = false;
    child.stdout.on('data', d => { out += d.toString('utf8'); });
    child.stderr.on('data', d => { err += d.toString('utf8'); });
    child.on('close', () => {
      if (killed) return;
      const text = out + err;
      if (text) {
        try {
          writeCachedHelp(harness.name, text);
        } catch {
          // best effort
        }
      }
    });
    child.on('error', () => { killed = true; /* binary missing */ });
    child.unref();
  } catch {
    // ignore — drift detection is best-effort
  }
}

/**
 * Check drift for a single harness. Returns:
 *   { status: 'unknown', reason }                          binary missing or no cache yet
 *   { status: 'fresh' }                                    cache populated as new baseline
 *   { status: 'match', sha }                               cached sha matches config
 *   { status: 'drift', sha, prevSha, prevDate, diff, leaks } drift detected
 *
 * Side effect: if cache is older than CACHE_TTL_HOURS, kick off an async
 * refresh in the background. Result of THIS call uses the current cache.
 */
export function checkDrift(harnessName) {
  const harness = HARNESSES[harnessName];
  if (!harness) return { status: 'unknown', reason: 'no-such-harness' };

  let cachedText = readCachedHelp(harnessName);
  const ageHours = cacheAgeHours(harnessName);

  // Bootstrap: no cache → fingerprint synchronously this once
  if (cachedText === null) {
    const text = fingerprintSync(harness);
    if (text === null) return { status: 'unknown', reason: 'binary-missing' };
    writeCachedHelp(harnessName, text);
    cachedText = text;
  } else if (ageHours > CACHE_TTL_HOURS) {
    // Stale: refresh in background, use current cache for this comparison
    refreshCacheAsync(harness);
  }

  const cachedSha = sha(cachedText);
  const config = loadConfig();
  const stored = config.harnesses?.[harnessName];

  // No acknowledged baseline yet → silently establish it
  if (!stored?.cli_signature_sha) {
    setBaselineFromText(harnessName, cachedText, cachedSha);
    return { status: 'fresh' };
  }

  if (stored.cli_signature_sha === cachedSha) {
    return { status: 'match', sha: cachedSha };
  }

  // Drift: compute line diff + leak token hits against last-acknowledged copy
  const ackPath = helpAcknowledgedPath(harnessName);
  const oldText = existsSync(ackPath) ? readFileSync(ackPath, 'utf8') : '';
  const diff = simpleLineDiff(oldText, cachedText);
  const leaks = detectLeaks(harness, oldText, cachedText);

  return {
    status: 'drift',
    sha: cachedSha,
    prevSha: stored.cli_signature_sha,
    prevDate: stored.last_audited,
    diff,
    leaks,
  };
}

function helpAcknowledgedPath(name) {
  return join(getCacheDir(), `${name}.acknowledged.txt`);
}

function setBaselineFromText(name, text, shaHex) {
  ensureCacheDir();
  // Stash an "acknowledged" snapshot alongside the live cache so we can diff
  // against the LAST ACKNOWLEDGED state when drift fires later.
  writeFileSync(helpAcknowledgedPath(name), text, 'utf8');
  const config = loadConfig();
  config.harnesses = config.harnesses || {};
  config.harnesses[name] = {
    bin: HARNESSES[name].bin,
    cli_signature_sha: shaHex,
    last_audited: today(),
  };
  saveConfig(config);
}

/**
 * Public: acknowledge current cached state as the new baseline. Called by
 * `claunch audit` after the user reviews the diff.
 */
export function acknowledge(harnessName) {
  const harness = HARNESSES[harnessName];
  if (!harness) return false;
  const cachedText = readCachedHelp(harnessName);
  if (cachedText === null) return false;
  setBaselineFromText(harnessName, cachedText, sha(cachedText));
  return true;
}

/**
 * Public: force-refresh cache synchronously and re-evaluate drift. Used by
 * `claunch audit <name>` so the user sees ground truth, not stale cache.
 */
export function refreshAndCheck(harnessName) {
  const harness = HARNESSES[harnessName];
  if (!harness) return { status: 'unknown', reason: 'no-such-harness' };
  const text = fingerprintSync(harness);
  if (text === null) return { status: 'unknown', reason: 'binary-missing' };
  writeCachedHelp(harnessName, text);
  return checkDrift(harnessName);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function simpleLineDiff(oldText, newText) {
  const oldSet = new Set((oldText || '').split('\n'));
  const newSet = new Set((newText || '').split('\n'));
  const added = [...newSet].filter(l => !oldSet.has(l) && l.trim());
  const removed = [...oldSet].filter(l => !newSet.has(l) && l.trim());
  return { added, removed };
}

/**
 * Whole-token containment. `--remote` matches `--remote ` and `--remote=foo`
 * but NOT `--remote-control-session-name-prefix` (the prefix-of-longer-flag
 * case) and NOT `use-remote` (the suffix-of-longer-token case). Boundary char
 * = anything that's not [a-zA-Z0-9_-]. We check BOTH sides.
 *
 * Special case: a token ending in `-` (e.g. `--dangerously-`) intentionally
 * matches any `--dangerously-X` family — we only require left-boundary then.
 */
function hasToken(text, token) {
  if (!text || !token) return false; // empty token would loop forever
  const isIdent = (c) => /[a-zA-Z0-9_-]/.test(c);
  let from = 0;
  while (true) {
    const idx = text.indexOf(token, from);
    if (idx === -1) return false;
    const before = idx > 0 ? text.charAt(idx - 1) : '';
    const after = text.charAt(idx + token.length);
    const leftOk = !before || !isIdent(before);
    const rightOk = token.endsWith('-') || !after || !isIdent(after);
    if (leftOk && rightOk) return true;
    from = idx + 1;
  }
}

function detectLeaks(harness, oldText, newText) {
  const found = [];
  for (const token of harness.leak_tokens) {
    const inOld = hasToken(oldText, token);
    const inNew = hasToken(newText, token);
    if (!inOld && inNew) found.push(token);
  }
  return found;
}

/**
 * Print drift warning to stderr. Called once per launch BEFORE spawning the
 * harness, so it appears above the harness's own output.
 */
export function surfaceDriftWarning(driftResult, harnessName) {
  if (!driftResult || driftResult.status !== 'drift') return;
  const Y = '\x1b[33m';
  const B = '\x1b[1m';
  const D = '\x1b[2m';
  const R = '\x1b[0m';
  const e = process.stderr;

  e.write(`\n${Y}${B}⚠ ${harnessName} CLI surface changed since ${driftResult.prevDate || 'baseline'}.${R}\n`);
  e.write(`${D}  claunch's launcher model may not expose new modes/flags.${R}\n`);

  if (driftResult.leaks.length > 0) {
    e.write(`${Y}  Possible abstraction leaks (new tokens):${R}\n`);
    for (const t of driftResult.leaks) {
      e.write(`${Y}    + ${t}${R}\n`);
    }
  }

  if (driftResult.diff.added.length > 0) {
    const preview = driftResult.diff.added.slice(0, 3);
    e.write(`${D}  ${driftResult.diff.added.length} new line(s) in --help. Sample:${R}\n`);
    for (const line of preview) {
      e.write(`${D}    + ${line.slice(0, 100)}${R}\n`);
    }
  }

  e.write(`${D}  Review and acknowledge: \`claunch audit ${harnessName}\`${R}\n\n`);
}

// Internal exports for tests
export const _internal = {
  sha,
  simpleLineDiff,
  detectLeaks,
  hasToken,
  cacheAgeHours,
  helpTextPath,
  helpAcknowledgedPath,
  fingerprintSync,
  setBaselineFromText,
  CACHE_TTL_HOURS,
};
