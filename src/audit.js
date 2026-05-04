/**
 * `claunch audit [harness]` command.
 *
 * - No args: audit all harnesses, print a one-line summary each.
 * - With harness name: synchronously refresh the cache, show full diff,
 *   prompt to acknowledge.
 */

import { createInterface } from 'readline';
import { HARNESSES } from './harness.js';
import { checkDrift, refreshAndCheck, acknowledge } from './drift.js';

const Y = '\x1b[33m';
const G = '\x1b[32m';
const D = '\x1b[2m';
const B = '\x1b[1m';
const R = '\x1b[0m';

export async function cmdAudit(args) {
  const target = args[0];

  if (target) {
    if (!HARNESSES[target]) {
      console.error(`Unknown harness: ${target}. Known: ${Object.keys(HARNESSES).join(', ')}`);
      process.exit(1);
    }
    await auditOne(target, true);
    return;
  }

  console.log('Auditing all harnesses...\n');
  for (const name of Object.keys(HARNESSES)) {
    await auditOne(name, false);
  }
  console.log(`\n${D}Run \`claunch audit <harness>\` for full diff and to acknowledge drift.${R}`);
}

async function auditOne(name, interactive) {
  // Always force a sync refresh in interactive mode so the user sees ground truth.
  // In summary mode use cached value (cheaper).
  const result = interactive ? refreshAndCheck(name) : checkDrift(name);

  if (result.status === 'unknown') {
    const reason = result.reason === 'binary-missing' ? 'not installed' : 'unknown';
    console.log(`  ${name}: ${D}${reason}${R}`);
    return;
  }

  if (result.status === 'fresh') {
    console.log(`  ${name}: ${G}baseline established${R}`);
    return;
  }

  if (result.status === 'match') {
    console.log(`  ${name}: ${G}✓ no drift${R}  ${D}sha ${result.sha.slice(0, 12)}...${R}`);
    return;
  }

  // Drift
  console.log(`\n${Y}${B}⚠ ${name}${R}: ${Y}CLI surface changed since ${result.prevDate || 'baseline'}${R}`);
  console.log(`${D}    prev sha ${result.prevSha?.slice(0, 12)}...${R}`);
  console.log(`${D}    curr sha ${result.sha.slice(0, 12)}...${R}`);

  if (result.leaks.length > 0) {
    console.log(`\n  ${Y}Possible abstraction leaks (tokens that didn't appear before):${R}`);
    for (const t of result.leaks) {
      console.log(`    ${Y}+ ${t}${R}`);
    }
    console.log(`  ${D}These suggest new modes/flags claunch may need to expose.${R}`);
  }

  if (result.diff.added.length > 0) {
    console.log(`\n  Added lines (${result.diff.added.length}):`);
    for (const line of result.diff.added) {
      console.log(`    ${G}+${R} ${line}`);
    }
  }

  if (result.diff.removed.length > 0) {
    console.log(`\n  Removed lines (${result.diff.removed.length}):`);
    for (const line of result.diff.removed) {
      console.log(`    ${D}- ${line}${R}`);
    }
  }

  if (!interactive) {
    return;
  }

  console.log();
  if (process.stdin.isTTY && process.stdout.isTTY) {
    const answer = await prompt(`  Acknowledge and update baseline? (y/N) `);
    const yes = ['y', 'yes'].includes(answer.toLowerCase().trim());
    if (yes) {
      const ok = acknowledge(name);
      if (ok) {
        console.log(`  ${G}✓ Baseline updated for ${name}${R}`);
      } else {
        console.log(`  ${Y}Could not update baseline (binary missing or cache empty).${R}`);
      }
    } else {
      console.log(`  ${D}Baseline left unchanged. Drift warning will keep firing.${R}`);
    }
  } else {
    console.log(`  ${D}Non-TTY: not prompting for acknowledgement.${R}`);
  }
}

function prompt(q) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(q, ans => { rl.close(); resolve(ans); }));
}
