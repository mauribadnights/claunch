# claunch v0.5 — multi-harness launcher + drift detector

## Goal

Single command `c` (alias of `claunch`) that:
1. Shows a harness picker first (claude / codex / pi)
2. For Claude: agent picker → dir picker (current flow)
3. For Codex / Pi: dir picker only (no sub-agents in either)
4. Auto-injects per-harness flags (Codex `--dangerously-bypass-approvals-and-sandbox` + goals flag, etc.)

Plus a drift detector so when a harness gains a new mode/flag (e.g. Pi adds non-cwd mode, Codex changes `--dangerously-bypass-approvals-and-sandbox`), claunch surfaces a warning automatically and tells me to update the wrapper.

## Backward compatibility (non-negotiable)

- `claunch` (no args, TTY) → harness picker (NEW)
- `claunch <project>` → list agents (UNCHANGED, defaults to claude)
- `claunch <project> <agent> [args...]` → launch claude (UNCHANGED)
- `claunch claude <project> [agent] [args...]` → explicit claude harness (NEW)
- `claunch codex <project> [args...]` → codex harness (NEW)
- `claunch pi <project> [args...]` → pi harness (NEW)
- `c` → alias of `claunch` (NEW, added to bin in package.json)

Heuristic: if first arg matches a known harness name (`claude`/`codex`/`pi`), parse as harness selector. Otherwise treat as project name (legacy).

## Architecture

### New files
- `src/harness.js` — harness definitions: name, binary, supports_agents, fingerprint command, default flags
- `src/drift.js` — drift detector: hash CLI surface, store, compare, surface warnings
- `src/audit.js` — `audit` and `audit-harness` commands

### Modified files
- `src/cli.js` — harness routing, new commands
- `src/config.js` — extend schema (`defaults.codex_flags`, `defaults.pi_flags`, `harnesses` block)
- `src/launcher.js` — dispatch to selected harness
- `src/interactive.js` — harness picker step prepended
- `src/tui.js` — single-list picker primitive (for harness step)

### Config schema additions

```yaml
defaults:
  claude_flags: [--dangerously-skip-permissions]   # existing
  codex_flags: [--dangerously-bypass-approvals-and-sandbox, ...goals_flag]  # NEW
  pi_flags: []  # NEW

harnesses:                                          # NEW (drift detector state)
  claude:
    bin: claude
    cli_signature_sha: <hash>
    last_audited: YYYY-MM-DD
  codex:
    bin: codex
    cli_signature_sha: <hash>
    last_audited: YYYY-MM-DD
  pi:
    bin: pi
    cli_signature_sha: <hash>
    last_audited: YYYY-MM-DD
```

## Drift detector mechanism

**Goal**: surface automatically when a harness gains a feature/mode that the abstraction doesn't handle, so I never forget to update claunch.

**Mechanism**:
1. On every launch (cheap path, sync), run `<bin> --help 2>&1 | sha256` and compare to `harnesses.<name>.cli_signature_sha` in config.
2. If hash differs from stored → at end of session (after the spawned process exits) or before launch:
   - Print bold warning: `⚠ <harness> CLI surface changed since <last_audited>. New flags or modes may exist that claunch doesn't expose.`
   - Print what's new (added lines via simple line-diff vs cached help text at `~/.claunch/help-cache/<harness>.txt`)
   - Suggest: `Run \`claunch audit <harness>\` to review and acknowledge.`
3. `claunch audit <harness>` → shows full diff, asks `acknowledge? (y/N)`, on y updates stored sha + last_audited and refreshes the cached help text.
4. `claunch audit` (no arg) → audits all configured harnesses.

**Latency budget**: <50ms added per launch. The hash is cached in memory only at audit time; per-launch we just hash `<bin> --help` (which itself runs in ~30ms locally for these CLIs).

**Bootstrap**: first run after upgrade, harnesses block is empty → claunch hashes whatever `<bin> --help` says now and stores as baseline. No spurious "drift" warning on first run.

**Failure mode**: if `<bin>` is not installed, drift check silently no-ops (returns null hash), and the launcher itself errors as before with ENOENT.

## What I still need to figure out

- **Codex's goals flag**: Mauricio mentioned "the flag to enable the goals feature every time that I run codecs". Need to find what this flag is. → Dispatching research agent.
- **Pi's exact CLI**: need the precise binary name + flag surface to set baseline.

## Tasks

- [x] Read existing claunch source (cli.js, launcher.js, interactive.js, config.js, tui.js, discovery.js, frecency.js, fuzzy.js, completions.js)
- [x] Dispatch Codex CLI audit (found `--enable goals` mechanism)
- [x] Dispatch Pi CLI audit (confirmed no sub-agents, no sandbox flags)
- [x] Implement `src/harness.js`
- [x] Implement `src/drift.js`
- [x] Implement `src/audit.js`
- [x] Implement `src/picker.js` (single-pane vertical selector)
- [x] Modify `src/launcher.js` to dispatch per harness with drift check
- [x] Modify `src/interactive.js` to add harness picker step
- [x] Modify `src/cli.js` to route per harness + add `audit` command
- [x] Modify `src/config.js` to handle new schema with backward compat
- [x] Modify `src/completions.js` for harness-aware completions
- [x] Add `c` bin to package.json (npm-link or fresh install picks it up)
- [x] Tests: harness, launcher, drift, config — 36 passing
- [x] Adversarial review by boiler-critic — all CRITICAL/HIGH findings addressed
- [x] Boundary fix in `hasToken` (left-side check + empty token guard)
- [x] Atomic-rename cache writes to prevent race corruption
- [x] Async cache child gets 10s timeout
- [x] Accept non-zero `--help` exit codes if there's output
- [x] Manual smoke tests (legacy path, new harness paths, audit, drift detection)
- [x] Update README to v0.5

Remaining (not blocking):
- [ ] git commit
- [ ] npm publish 0.5.0
- [ ] verify `claunch update` upgrade path on a fresh shell

## Definition of done — STATUS

- [x] Picker shows harness step → agent (Claude only) → dir step
- [x] `c codex <project>` builds correct argv (verified by unit test) and would boot codex with bypass + goals
- [x] `c pi <project>` builds correct argv
- [x] All legacy `claunch <project>` and `claunch <project> <agent>` paths preserved (verified live)
- [x] 36/36 tests pass
- [x] Drift detector fires on mutated help text (verified live with `--cwd` injection into pi cache)
- [x] Drift warning silent on first run (baseline establishment) — verified
- [x] Drift detection no-ops cleanly on missing binaries — verified by unit test

## Critic findings — disposition

| ID | Severity | Status                                                                                          |
|----|----------|-------------------------------------------------------------------------------------------------|
| C1 | CRITICAL | Documented in DEFAULT_DEFAULTS comment + README footgun warning. Behavior is intentional.       |
| C2 | CRITICAL | Fixed: hasToken now checks both sides for boundary chars.                                       |
| H1 | HIGH     | Fixed: writeCachedHelp uses temp + renameSync for atomic write.                                 |
| H2 | HIGH     | Fixed: fingerprintSync + refreshCacheAsync now accept non-zero exit if output exists.           |
| H3 | HIGH     | Documented in README "Reserved names" section. No code fix (would require breaking dispatch).   |
| H4 | HIGH     | Acknowledged. No harness-affinity data exists yet. Future enhancement.                          |
| M1 | MEDIUM   | Set-based diff is informational; documented behavior. Future enhancement to use LCS.            |
| M2 | MEDIUM   | Fixed: async refresh child has 10s timeout.                                                     |
| M3 | MEDIUM   | Polish; deferred. PLAIN_CLAUDE leaks through interactive.js (used by cli.js).                   |
| M4 | MEDIUM   | Documented limitation. Hard to mitigate generically.                                            |
| L1-L3 | LOW   | Acknowledged. L3 (empty token) fixed alongside C2.                                              |
