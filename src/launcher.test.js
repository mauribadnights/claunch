import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArgs } from './launcher.js';
import { HARNESSES } from './harness.js';

test('claude args: agent + add-dirs + flags + extras + passthrough', () => {
  const args = buildArgs(HARNESSES.claude, {
    agent: 'cto',
    addDirs: ['/extra1', '/extra2'],
    flags: ['--dangerously-skip-permissions'],
    extraFlags: ['--verbose'],
    passthrough: ['hello'],
    dir: '/wd',
  });
  assert.deepEqual(args, [
    '--agent', 'cto',
    '--add-dir', '/extra1',
    '--add-dir', '/extra2',
    '--dangerously-skip-permissions',
    '--verbose',
    'hello',
  ]);
});

test('claude args: no agent (plain claude)', () => {
  const args = buildArgs(HARNESSES.claude, {
    agent: null,
    addDirs: [],
    flags: ['--dangerously-skip-permissions'],
    extraFlags: [],
    passthrough: [],
    dir: '/wd',
  });
  assert.deepEqual(args, ['--dangerously-skip-permissions']);
});

test('codex args: only flags + passthrough; agent/addDirs ignored', () => {
  const args = buildArgs(HARNESSES.codex, {
    agent: 'cto', // should be ignored
    addDirs: ['/x'], // should be ignored
    flags: ['--dangerously-bypass-approvals-and-sandbox', '--enable', 'goals'],
    extraFlags: ['--should-not-appear'], // claude-only
    passthrough: ['prompt'],
    dir: '/wd',
  });
  assert.deepEqual(args, [
    '--dangerously-bypass-approvals-and-sandbox',
    '--enable', 'goals',
    'prompt',
  ]);
});

test('pi args: only flags + passthrough', () => {
  const args = buildArgs(HARNESSES.pi, {
    agent: 'whatever',
    addDirs: ['/x'],
    flags: ['--no-tools'],
    extraFlags: ['ignored'],
    passthrough: ['prompt'],
    dir: '/wd',
  });
  assert.deepEqual(args, ['--no-tools', 'prompt']);
});

test('unknown harness falls back to flags+passthrough', () => {
  const fakeHarness = { name: 'mystery', bin: 'mystery' };
  const args = buildArgs(fakeHarness, {
    agent: 'a',
    addDirs: ['/x'],
    flags: ['--f'],
    extraFlags: ['--ignored'],
    passthrough: ['p'],
    dir: '/wd',
  });
  assert.deepEqual(args, ['--f', 'p']);
});
