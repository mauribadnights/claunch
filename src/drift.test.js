import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { _internal, checkDrift, acknowledge, refreshAndCheck, surfaceDriftWarning } from './drift.js';
import { HARNESSES } from './harness.js';

let tmpDir;
let origConfigDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'claunch-drift-test-'));
  origConfigDir = process.env.CLAUNCH_CONFIG_DIR;
  process.env.CLAUNCH_CONFIG_DIR = tmpDir;
});

afterEach(() => {
  if (origConfigDir === undefined) {
    delete process.env.CLAUNCH_CONFIG_DIR;
  } else {
    process.env.CLAUNCH_CONFIG_DIR = origConfigDir;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

test('sha is deterministic and differs for different inputs', () => {
  const { sha } = _internal;
  assert.equal(sha('abc'), sha('abc'));
  assert.notEqual(sha('abc'), sha('abd'));
  assert.equal(sha('').length, 64);
});

test('simpleLineDiff finds added and removed lines', () => {
  const { simpleLineDiff } = _internal;
  const oldText = 'line1\nline2\nline3';
  const newText = 'line1\nline3\nline4\nline5';
  const diff = simpleLineDiff(oldText, newText);
  assert.deepEqual(diff.added.sort(), ['line4', 'line5']);
  assert.deepEqual(diff.removed, ['line2']);
});

test('simpleLineDiff ignores blank-line whitespace differences', () => {
  const { simpleLineDiff } = _internal;
  const diff = simpleLineDiff('foo\n\nbar', 'foo\nbar');
  // Blank lines filtered out by trim() check
  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.removed, []);
});

test('detectLeaks fires only on tokens that newly appear', () => {
  const { detectLeaks } = _internal;
  const harness = {
    leak_tokens: ['--remote', '--exec', 'app-server'],
  };
  const oldText = 'usage: foo --bar\n';
  const newText = 'usage: foo --bar\n--remote <addr>\n';
  const leaks = detectLeaks(harness, oldText, newText);
  assert.deepEqual(leaks, ['--remote']);
});

test('detectLeaks does not fire if token was always present', () => {
  const { detectLeaks } = _internal;
  const harness = { leak_tokens: ['--exec'] };
  assert.deepEqual(detectLeaks(harness, '--exec yes', '--exec yes here too'), []);
});

test('hasToken whole-word matching: --remote does not match --remote-control', () => {
  const { hasToken } = _internal;
  assert.equal(hasToken('--remote-control-session-name', '--remote'), false);
  assert.equal(hasToken('--remote <addr>', '--remote'), true);
  assert.equal(hasToken('use --remote=ws://x', '--remote'), true);
  assert.equal(hasToken('end-of-line --remote', '--remote'), true);
  assert.equal(hasToken('', '--remote'), false);
});

test('hasToken left-boundary: token suffix-of-longer is not a match', () => {
  const { hasToken } = _internal;
  // `use-remote --foo` — `--remote` should NOT match (left side is `e-`)
  assert.equal(hasToken('use-remote --foo', '--remote'), false);
  // `xremote --foo` — `--remote` should NOT match (`x` is identifier char)
  assert.equal(hasToken('xremote --foo', '--remote'), false);
  // line start
  assert.equal(hasToken('--remote stuff', '--remote'), true);
  // after newline
  assert.equal(hasToken('preamble\n--remote stuff', '--remote'), true);
});

test('hasToken empty inputs: never infinite loops', () => {
  const { hasToken } = _internal;
  assert.equal(hasToken('some text', ''), false);
  assert.equal(hasToken('', 'whatever'), false);
  assert.equal(hasToken(null, 'x'), false);
  assert.equal(hasToken('x', null), false);
});

test('hasToken trailing-dash convention: --dangerously- matches any --dangerously-X', () => {
  const { hasToken } = _internal;
  assert.equal(hasToken('--dangerously-bypass-approvals', '--dangerously-'), true);
  assert.equal(hasToken('--dangerously-skip-permissions', '--dangerously-'), true);
  assert.equal(hasToken('--dangerous_old_flag', '--dangerously-'), false);
});

test('detectLeaks does NOT trigger on --remote when only --remote-control-* exists', () => {
  const { detectLeaks } = _internal;
  const harness = { leak_tokens: ['--remote'] };
  const oldText = '  --remote-control-session-name <prefix>  ...';
  const newText = '  --remote-control-session-name <prefix>  ...\n  --remote <addr>  new flag';
  assert.deepEqual(detectLeaks(harness, oldText, newText), ['--remote']);
});

test('checkDrift returns binary-missing for nonexistent harness binary', () => {
  // Inject a fake harness into HARNESSES temporarily
  const origCodex = HARNESSES.codex;
  HARNESSES.codex = {
    ...origCodex,
    bin: '/nonexistent/binary-abcxyz',
    fingerprint_args: ['--help'],
  };
  try {
    const result = checkDrift('codex');
    assert.equal(result.status, 'unknown');
    assert.equal(result.reason, 'binary-missing');
  } finally {
    HARNESSES.codex = origCodex;
  }
});

test('checkDrift returns "fresh" on first run with installed binary', () => {
  // Use a binary that exists and produces stable output: `echo`
  const origPi = HARNESSES.pi;
  HARNESSES.pi = {
    ...origPi,
    bin: '/bin/echo',
    fingerprint_args: ['hello'],
  };
  try {
    const result = checkDrift('pi');
    assert.equal(result.status, 'fresh');
    // Cache file should now exist
    assert.ok(existsSync(join(tmpDir, 'help-cache', 'pi.txt')));
    // Acknowledged file should now exist
    assert.ok(existsSync(join(tmpDir, 'help-cache', 'pi.acknowledged.txt')));
    // Config should now exist with the baseline written
    assert.ok(existsSync(join(tmpDir, 'config.yaml')));
    const yaml = readFileSync(join(tmpDir, 'config.yaml'), 'utf8');
    assert.ok(yaml.includes('cli_signature_sha'));
  } finally {
    HARNESSES.pi = origPi;
  }
});

test('checkDrift returns "match" when nothing changed', () => {
  const origPi = HARNESSES.pi;
  HARNESSES.pi = {
    ...origPi,
    bin: '/bin/echo',
    fingerprint_args: ['stable-output'],
  };
  try {
    // First call establishes baseline
    const r1 = checkDrift('pi');
    assert.equal(r1.status, 'fresh');
    // Second call should match
    const r2 = checkDrift('pi');
    assert.equal(r2.status, 'match');
  } finally {
    HARNESSES.pi = origPi;
  }
});

test('refreshAndCheck detects drift when --help output changes', () => {
  const origPi = HARNESSES.pi;

  // Step 1: bootstrap with output A
  HARNESSES.pi = { ...origPi, bin: '/bin/echo', fingerprint_args: ['version-A'] };
  let r = checkDrift('pi');
  assert.equal(r.status, 'fresh');

  // Step 2: simulate drift by mutating the cached help text directly (faster
  // than swapping binaries) to a different value
  writeFileSync(join(tmpDir, 'help-cache', 'pi.txt'), 'version-B-different\n', 'utf8');

  // Step 3: refreshAndCheck — but with same fingerprint_args, refresh would
  // overwrite our manual change with 'version-A\n'. To actually test drift,
  // we change the fingerprint_args to produce different output.
  HARNESSES.pi = { ...origPi, bin: '/bin/echo', fingerprint_args: ['version-B-different'] };
  r = refreshAndCheck('pi');
  HARNESSES.pi = origPi;

  assert.equal(r.status, 'drift');
  assert.ok(r.diff.added.length > 0);
});

test('acknowledge updates baseline so subsequent checks return match', () => {
  const origPi = HARNESSES.pi;
  HARNESSES.pi = { ...origPi, bin: '/bin/echo', fingerprint_args: ['initial'] };
  try {
    checkDrift('pi'); // fresh

    // Drift event
    HARNESSES.pi = { ...origPi, bin: '/bin/echo', fingerprint_args: ['changed'] };
    let r = refreshAndCheck('pi');
    assert.equal(r.status, 'drift');

    // Acknowledge
    const ok = acknowledge('pi');
    assert.equal(ok, true);

    // Now match
    r = checkDrift('pi');
    assert.equal(r.status, 'match');
  } finally {
    HARNESSES.pi = origPi;
  }
});

test('cacheAgeHours returns Infinity when cache absent', () => {
  const { cacheAgeHours } = _internal;
  assert.equal(cacheAgeHours('does-not-exist'), Infinity);
});

test('surfaceDriftWarning silently no-ops on non-drift status', () => {
  // Capture stderr
  const origWrite = process.stderr.write.bind(process.stderr);
  let captured = '';
  process.stderr.write = (chunk) => { captured += chunk; return true; };
  try {
    surfaceDriftWarning({ status: 'match', sha: 'abc' }, 'codex');
    surfaceDriftWarning({ status: 'fresh' }, 'codex');
    surfaceDriftWarning({ status: 'unknown', reason: 'binary-missing' }, 'codex');
    surfaceDriftWarning(null, 'codex');
    assert.equal(captured, '');
  } finally {
    process.stderr.write = origWrite;
  }
});

test('surfaceDriftWarning prints warning on drift', () => {
  const origWrite = process.stderr.write.bind(process.stderr);
  let captured = '';
  process.stderr.write = (chunk) => { captured += chunk; return true; };
  try {
    surfaceDriftWarning({
      status: 'drift',
      prevDate: '2026-05-04',
      diff: { added: ['+ new flag --remote <addr>'], removed: [] },
      leaks: ['--remote'],
    }, 'codex');
    assert.ok(captured.includes('CLI surface changed'));
    assert.ok(captured.includes('--remote'));
    assert.ok(captured.includes('claunch audit codex'));
  } finally {
    process.stderr.write = origWrite;
  }
});
