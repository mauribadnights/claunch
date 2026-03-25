import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import YAML from 'yaml';
import { getConfigDir } from './config.js';

/**
 * Frecency ranking using Mozilla's continuous exponential decay.
 *
 * Each item stores a single float `frecDate` — the epoch (seconds) when
 * the item's decayed score would equal 1.0. The actual score at any
 * moment is: score = exp((frecDate - now) * LAMBDA).
 *
 * On each access the score is bumped by +1 and re-encoded to a new frecDate.
 * Items never accessed are absent from the store (score = 0).
 *
 * Half-life: 14 days — something unused for ~2 weeks drops to half its peak.
 */
const HALF_LIFE_DAYS = 14;
const LAMBDA = Math.log(2) / (HALF_LIFE_DAYS * 24 * 3600); // per second

function getFrecencyPath(kind) {
  return join(getConfigDir(), `${kind}-frecency.yaml`);
}

function loadFrecency(kind) {
  const path = getFrecencyPath(kind);
  if (!existsSync(path)) return {};
  try {
    return YAML.parse(readFileSync(path, 'utf8')) || {};
  } catch {
    return {};
  }
}

function saveFrecency(kind, data) {
  const path = getFrecencyPath(kind);
  writeFileSync(path, YAML.stringify(data, { lineWidth: 120 }), 'utf8');
}

/** Get the current frecency score for an item. Returns 0 if never accessed. */
function getScore(frecDate, now = Date.now() / 1000) {
  if (!frecDate) return 0;
  return Math.exp((frecDate - now) * LAMBDA);
}

/** Record an access for an item, updating its frecDate. */
function recordAccess(kind, key) {
  const data = loadFrecency(kind);
  const now = Date.now() / 1000;
  const currentScore = getScore(data[key], now);
  const newScore = currentScore + 1.0;
  data[key] = now + Math.log(newScore) / LAMBDA;
  saveFrecency(kind, data);
}

/**
 * Get a score map { key: score } for all tracked items of a kind.
 * Only includes items with score > 0.001 (effectively pruning dead entries).
 */
function getScores(kind) {
  const data = loadFrecency(kind);
  const now = Date.now() / 1000;
  const scores = {};
  for (const [key, frecDate] of Object.entries(data)) {
    const score = getScore(frecDate, now);
    if (score > 0.001) {
      scores[key] = score;
    }
  }
  return scores;
}

/**
 * Sort an array of items by frecency, preserving original order for unscored items.
 * @param {Array} items - items to sort
 * @param {Function} keyFn - extract the frecency key from an item
 * @param {Object} scores - score map from getScores()
 * @returns {Array} sorted copy
 */
function sortByFrecency(items, keyFn, scores) {
  const scored = [];
  const unscored = [];

  for (const item of items) {
    const key = keyFn(item);
    const score = scores[key] || 0;
    if (score > 0) {
      scored.push({ item, score });
    } else {
      unscored.push(item);
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return [...scored.map(s => s.item), ...unscored];
}

export { recordAccess, getScores, sortByFrecency, getScore, LAMBDA };
