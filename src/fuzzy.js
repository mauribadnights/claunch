/**
 * Simple fuzzy matcher. Returns a score (higher = better match).
 * Returns -1 if no match.
 */
function fuzzyScore(query, target) {
  if (!query) return 1; // empty query matches everything
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // Exact substring
  if (t.includes(q)) return 100 + (1 / t.length);

  // Fuzzy: every query char must appear in order
  let qi = 0;
  let consecutive = 0;
  let score = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      consecutive++;
      score += consecutive; // reward consecutive matches
    } else {
      consecutive = 0;
    }
  }

  if (qi < q.length) return -1; // not all chars matched
  return score;
}

/**
 * Filter and rank items by fuzzy query.
 * Each item must have a `searchText` property.
 * When frecencyScores is provided, blends fuzzy match with frecency.
 * @param {Array} items
 * @param {string} query
 * @param {Object} [opts]
 * @param {Object} [opts.frecencyScores] - { key: score } map
 * @param {Function} [opts.frecencyKeyFn] - extract key from item for frecency lookup
 */
function fuzzyFilter(items, query, opts = {}) {
  const { frecencyScores, frecencyKeyFn } = opts;

  if (!query) {
    // No query: return all items, sorted by frecency if available
    if (frecencyScores && frecencyKeyFn) {
      return [...items].sort((a, b) => {
        const sa = frecencyScores[frecencyKeyFn(a)] || 0;
        const sb = frecencyScores[frecencyKeyFn(b)] || 0;
        // Scored items first (descending), then unscored in original order
        if (sa > 0 && sb > 0) return sb - sa;
        if (sa > 0) return -1;
        if (sb > 0) return 1;
        return 0;
      });
    }
    return items;
  }

  return items
    .map(item => {
      const fuzzy = fuzzyScore(query, item.searchText);
      let combined = fuzzy;
      // Boost fuzzy matches by frecency: add up to 50% bonus from frecency
      if (fuzzy > 0 && frecencyScores && frecencyKeyFn) {
        const frec = frecencyScores[frecencyKeyFn(item)] || 0;
        if (frec > 0) {
          combined = fuzzy * (1 + 0.5 * Math.min(frec, 1));
        }
      }
      return { item, score: combined, fuzzy };
    })
    .filter(({ fuzzy }) => fuzzy > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
}

export { fuzzyScore, fuzzyFilter };
