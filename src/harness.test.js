import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HARNESSES, HARNESS_NAMES, getHarness, isHarnessName, listHarnesses } from './harness.js';

test('HARNESSES has claude, codex, pi', () => {
  assert.equal(typeof HARNESSES.claude, 'object');
  assert.equal(typeof HARNESSES.codex, 'object');
  assert.equal(typeof HARNESSES.pi, 'object');
});

test('every harness has required fields', () => {
  const required = ['name', 'bin', 'label', 'description', 'supports_agents', 'default_flags_key', 'fingerprint_args', 'leak_tokens'];
  for (const h of Object.values(HARNESSES)) {
    for (const field of required) {
      assert.ok(field in h, `${h.name || '?'} missing field: ${field}`);
    }
    assert.ok(Array.isArray(h.fingerprint_args), `${h.name} fingerprint_args must be array`);
    assert.ok(Array.isArray(h.leak_tokens), `${h.name} leak_tokens must be array`);
  }
});

test('only claude supports agents', () => {
  assert.equal(HARNESSES.claude.supports_agents, true);
  assert.equal(HARNESSES.codex.supports_agents, false);
  assert.equal(HARNESSES.pi.supports_agents, false);
});

test('default_flags_key matches expected names', () => {
  assert.equal(HARNESSES.claude.default_flags_key, 'claude_flags');
  assert.equal(HARNESSES.codex.default_flags_key, 'codex_flags');
  assert.equal(HARNESSES.pi.default_flags_key, 'pi_flags');
});

test('codex leak tokens cover the documented non-cwd modes', () => {
  const tokens = HARNESSES.codex.leak_tokens;
  assert.ok(tokens.includes('--remote'));
  assert.ok(tokens.includes('app-server'));
  assert.ok(tokens.includes('exec-server'));
  assert.ok(tokens.includes('mcp-server'));
});

test('pi leak tokens cover the documented invariant breaks', () => {
  const tokens = HARNESSES.pi.leak_tokens;
  // Pi today: no --cwd, no --agent, no sandbox. Their appearance = leak.
  assert.ok(tokens.includes('--cwd'));
  assert.ok(tokens.includes('--agent'));
  assert.ok(tokens.includes('--sandbox'));
  assert.ok(tokens.includes('--dangerously-'));
});

test('getHarness returns null for unknown', () => {
  assert.equal(getHarness('nope'), null);
  assert.equal(getHarness(undefined), null);
});

test('isHarnessName is exact and string-typed', () => {
  assert.equal(isHarnessName('claude'), true);
  assert.equal(isHarnessName('codex'), true);
  assert.equal(isHarnessName('pi'), true);
  assert.equal(isHarnessName('Claude'), false);
  assert.equal(isHarnessName(''), false);
  assert.equal(isHarnessName(null), false);
  assert.equal(isHarnessName(123), false);
});

test('listHarnesses + HARNESS_NAMES are consistent', () => {
  assert.equal(listHarnesses().length, HARNESS_NAMES.length);
  assert.equal(HARNESS_NAMES.length, 3);
});
