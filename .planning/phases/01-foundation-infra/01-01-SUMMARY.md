---
phase: 01-foundation-infra
plan: 01
subsystem: bootstrap
tags: [bootstrap, version-pinning, workspace]
requires: []
provides:
  - bun-runtime-pin
  - workspace-script-contract
  - dev-tooling-baseline
affects:
  - all-downstream-plans
tech-stack:
  added:
    - bun@1.3.11 (runtime pin)
    - eslint@9.39.4
    - prettier@3.8.3
    - typescript@5.9.3
    - "@typescript-eslint/* @8.59.4"
    - bun-types@1.3.14
  patterns:
    - exact-version-pinning
    - frozen-lockfile-contract
key-files:
  created:
    - .bun-version
    - bun.lock
    - .planning/phases/01-foundation-infra/01-01-SUMMARY.md
  modified:
    - package.json
    - .gitignore
decisions:
  - "Pinned Bun to 1.3.11 exact via both .bun-version and packageManager — single source of truth, both files must equal verbatim (per ADR-003)."
  - "Explicit .env/.env.local/.env.*.local triplet in .gitignore instead of .env* glob — avoids masking .env.example which must remain committed."
  - "Lockfile generated via single-pass install with workspaces narrowed to services/* — packages/* and frontend manifests ship in P1.4/P1.5/P1.6; workspaces array restored to full triplet for downstream plans."
metrics:
  duration: ~8 minutes
  completed: 2026-05-24
---

# Phase 1 Plan 1: Version Pinning Summary

Pinned Bun to 1.3.11 across .bun-version and packageManager, expanded root scripts to the eight-entry contract (docker:up/down/prune, lint/format/typecheck/test/smoke:health), and committed the initial bun.lock locking eslint/prettier/typescript and the typescript-eslint v8 suite.

## What Shipped

| Artifact | Purpose |
|----------|---------|
| `.bun-version` | Literal `1.3.11` — consumed by Bun's auto-version selector and by future `oven/bun:1.3.11-alpine` Dockerfile tags |
| `package.json` `packageManager` | `bun@1.3.11` — must equal `.bun-version` verbatim; downstream tooling reads this |
| `package.json` `scripts` | Eight-entry contract: docker:up (`--wait`), docker:down, docker:prune, lint, format, typecheck, test, smoke:health |
| `package.json` `devDependencies` | eslint 9, prettier 3, typescript 5.6, typescript-eslint 8 trio, bun-types |
| `.gitignore` | Replaced — explicit env triplet, build outputs, bun cache, IDE dirs, test artifacts |
| `bun.lock` | 481 lines, 46 KB — locks 429 packages including transitive deps for the dev tooling baseline |

## Lockfile Chain-of-Custody

- **sha256 prefix**: `ca8c3007fb3deda3`
- **Size**: 46,405 bytes
- **First line**: `{` (JSON format — Bun 1.3.11 emits JSON lockfile)
- **Direct deps resolved**:
  - `@typescript-eslint/eslint-plugin@8.59.4`
  - `@typescript-eslint/parser@8.59.4`
  - `@typescript-eslint/utils@8.59.4`
  - `bun-types@1.3.14`
  - `eslint@9.39.4`
  - `prettier@3.8.3`
  - `typescript@5.9.3`

## Commits

| SHA | Message |
|-----|---------|
| `4fe1bac` | chore(01-01): pin Bun to 1.3.11 and harden gitignore |
| `b854f2d` | chore(01-01): expand root package.json with scripts and dev tooling |
| `6924863` | chore(01-01): generate bun.lock with pinned dev tooling |

## Acceptance Criteria — PASS

### Task 1
- `.bun-version` reads `1.3.11` — PASS
- `.gitignore` contains every required line — PASS
- `.gitignore` does NOT contain `.env*` glob — PASS

### Task 2
- `package.json.packageManager === "bun@1.3.11"` — PASS
- `workspaces === ["services/*", "packages/*", "frontend"]` — PASS
- All eight scripts present with exact command strings — PASS
- All seven devDependencies present at specified ranges — PASS
- `bun --version` prints `1.3.11` — PASS

### Task 3
- `bun.lock` exists, 46 KB, non-empty — PASS
- First line is JSON brace (acceptable per plan) — PASS
- `bun install` exited 0 (single-pass mode) — PASS
- `bun run lint` failed with "ESLint couldn't find an eslint.config.(js|mjs|cjs) file." — PASS (expected signal per plan; eslint config ships in P1.6)

## Deviations from Plan

### [Rule 3 — Blocking Issue] Two-pass install workaround required adjusted closure

The plan's two-pass workaround assumed Bun would tolerate workspace entries whose directories exist but lack `package.json` (`packages/` is empty, `frontend/` is empty). Bun 1.3.11 actually errors with `Workspace not found "frontend"` in that state.

**Resolution**:
1. Ran `bun install` with `workspaces` temporarily narrowed to `["services/*"]` — generated `bun.lock` containing the dev tooling and the two existing service workspaces.
2. Restored `workspaces` to the full `["services/*", "packages/*", "frontend"]` triplet so the manifest contract is intact for downstream plans (P1.4 ships `packages/shared-kernel/package.json`; P1.5/P1.6 ship `frontend/package.json`).
3. Did NOT re-run `bun install` against the restored workspaces — it would have failed because the missing manifests have not been authored yet. The lockfile from step 1 is the artifact we commit.

**Impact**: `bun install --frozen-lockfile` from a fresh clone will fail until the downstream workspace manifests land. The verification clause "frozen-lockfile is idempotent" cannot be re-checked at this exact point in time — it becomes verifiable after P1.4/P1.5/P1.6 complete. This is an expected temporary state during Phase 1 buildup and matches the plan's note that workspace bootstrap may require the two-pass dance.

**Files modified**: package.json (transient workspaces narrowing then restored).
**Commit**: subsumed into `6924863` (lockfile commit).

## Tooling Versions vs Semver Floor (Informational)

| Package | Declared range | Resolved version | Notes |
|---------|---------------|------------------|-------|
| eslint | ^9.0.0 | 9.39.4 | v10 available; held at 9 because P1.6 config targets 9 flat-config |
| prettier | ^3.0.0 | 3.8.3 | within range |
| typescript | ^5.6.0 | 5.9.3 | within range; v6 available but skipped per plan |
| @typescript-eslint/* | ^8.0.0 | 8.59.4 | within range |
| bun-types | latest | 1.3.14 | tracks bun runtime — minor drift from 1.3.11 acceptable, types are forward-compat |

## Downstream Contracts Now Available

- **P1.3 Dockerfile**: must use `oven/bun:1.3.11-alpine` base image to match `.bun-version` pin.
- **P1.4 shared-kernel**: when its `packages/shared-kernel/package.json` lands, root `bun install` will succeed against the full workspaces array.
- **P1.6 eslint plugin**: must author `eslint.config.js` consuming the v9 flat-config + typescript-eslint v8 declared here.
- **Phase 10 CI**: `bun run docker:up` blocks on `--wait` healthchecks; `bun run smoke:health` is the next-step contract.

## Self-Check: PASSED

- `.bun-version` — FOUND
- `bun.lock` — FOUND (46,405 bytes)
- `package.json` — FOUND with `packageManager: bun@1.3.11`
- `.gitignore` — FOUND with explicit env triplet
- Commit `4fe1bac` — FOUND
- Commit `b854f2d` — FOUND
- Commit `6924863` — FOUND
