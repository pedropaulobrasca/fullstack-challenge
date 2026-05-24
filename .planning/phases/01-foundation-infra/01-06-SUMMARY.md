---
phase: 01-foundation-infra
plan: 06
subsystem: tooling / lint
tags: [eslint, custom-rule, money-guard, prettier, flat-config]
requires: [01-01]
provides: [eslint-money-guard, eslint-process-env-guard, prettier-config]
affects: [packages/eslint-plugin, eslint.config.js, .prettierrc, package.json]
tech_stack_added:
  - "@crash/eslint-plugin (workspace package, private)"
  - "@typescript-eslint/utils ^8.0.0 (runtime dep)"
  - "@typescript-eslint/rule-tester ^8.0.0 (dev dep)"
patterns:
  - ESLintUtils.RuleCreator rule authoring
  - ESLint 9 flat config layered overrides
  - Workspace symlink via workspace:* root devDep
files_created:
  - packages/eslint-plugin/package.json
  - packages/eslint-plugin/tsconfig.json
  - packages/eslint-plugin/src/index.ts
  - packages/eslint-plugin/src/rules/no-number-for-money.ts
  - packages/eslint-plugin/tests/no-number-for-money.test.ts
  - packages/eslint-plugin/tests/fixtures/positive/balance-as-number.ts
  - packages/eslint-plugin/tests/fixtures/positive/bet-amount-cents.ts
  - packages/eslint-plugin/tests/fixtures/positive/interface-payout.ts
  - packages/eslint-plugin/tests/fixtures/negative/count-as-number.ts
  - packages/eslint-plugin/tests/fixtures/negative/index-as-number.ts
  - eslint.config.js
  - .prettierrc
  - .prettierignore
files_modified:
  - package.json
  - bun.lock
decisions:
  - "Lint config exempts services/*/src/main.ts from no-restricted-properties because the NestJS bootstrap must read PORT before AppModule loads (typed config layer arrives in P1.7)."
  - "Used .ts barrel import with allowImportingTsExtensions so Node 24's native type-stripping resolves the plugin under eslint without a build step."
  - "Added @crash/eslint-plugin as a workspace:* root devDependency to force Bun to materialize the node_modules/@crash symlink (otherwise unused workspaces are not linked)."
  - "Set root package.json type:module so eslint.config.js loads as ESM without warnings."
metrics:
  duration_seconds: 300
  task_count: 3
  file_count_created: 13
  file_count_modified: 2
  tests_pass: 8
  tests_fail: 0
completed: 2026-05-24
---

# Phase 01 Plan 06: ESLint Plugin Summary

Custom `@crash/no-number-for-money` rule enforced at error severity from the root flat config, plus a `no-restricted-properties` ban on `process.env` outside the (future) typed config layer and the NestJS bootstrap entry. Prettier is configured.

## Rule regex

```
/^(amount|balance|bet|payout|price|wager|cents|money|fee|stake|win|loss)$|^(.+(?:Amount|Balance|Bet|Payout|Price|Wager|Cents|Money|Fee|Stake|Win|Loss))$/
```

**Base words (12):** `amount`, `balance`, `bet`, `payout`, `price`, `wager`, `cents`, `money`, `fee`, `stake`, `win`, `loss`.

**Suffix variants:** any identifier ending in one of `Amount`, `Balance`, `Bet`, `Payout`, `Price`, `Wager`, `Cents`, `Money`, `Fee`, `Stake`, `Win`, `Loss` (PascalCase suffixes — case-sensitive on the suffix).

Examples flagged: `balance`, `betAmountCents`, `payout`, `wagerCents`, `totalAmount`.
Examples not flagged: `count`, `attemptCount`, `index`, `pageIndex`, `totalCount`, `multiplier`.

`multiplier` is intentionally NOT in the regex — Phase 4 will introduce a dedicated `Multiplier` VO and extend the rule (or add a sibling rule) at that point.

## AST visitors

| Node type | Catches |
|-----------|---------|
| `VariableDeclarator` | `const balance: number = ...` |
| `FunctionDeclaration > Identifier`, `ArrowFunctionExpression > Identifier`, `FunctionExpression > Identifier` | function parameters |
| `TSPropertySignature` | interface members |
| `PropertyDefinition` | class fields |

The type predicate accepts both `TSNumberKeyword` (`number`) and `TSTypeReference` with `typeName === "Number"`.

## Root flat config (eslint.config.js)

The flat config is an array of four entries, evaluated in order (later entries override earlier ones for matching files):

| Entry | Selector | Purpose |
|-------|----------|---------|
| 1 | `ignores: node_modules/, dist/, build/, coverage/, playwright-report/, test-results/, **/migrations/, .bun-cache/` | Global ignores. Migrations excluded because future MikroORM-generated migration files use raw bigint cents columns. |
| 2 | `**/*.ts` | Baseline: ts-parser + plugins `@typescript-eslint` and `@crash`; rules `@crash/no-number-for-money: error` and `no-restricted-properties` banning `process.env`. |
| 3 | `**/src/config/**/*.ts`, `**/mikro-orm.config.ts`, `services/*/src/main.ts` | Turns off the `process.env` ban for the three sanctioned readers: the typed config layer (P1.7), the MikroORM CLI config (P1.7+), and the NestJS bootstrap entry that must read `PORT` before module DI is available. |
| 4 | `**/tests/**/*.ts`, `**/*.test.ts` | Turns off the money rule for test code so fixtures and property tests can construct `number`-typed money on purpose. |

## Prettier (.prettierrc)

```json
{ "printWidth": 100, "tabWidth": 2, "useTabs": false, "semi": true,
  "singleQuote": false, "trailingComma": "all", "bracketSpacing": true,
  "arrowParens": "always", "endOfLine": "lf" }
```

`.prettierignore` mirrors the ESLint global ignore list plus `bun.lock`.

## Slopcheck — @typescript-eslint/rule-tester

| Field | Value |
|-------|-------|
| Latest version | 8.59.4 |
| License | MIT |
| Repository | typescript-eslint/typescript-eslint (same scope as parser + eslint-plugin already vetted in P1.1) |
| Maintainers | bradzacher, jameshenry (typescript-eslint core team) |
| Last published | 2026-05-18 (6 days ago) |
| Dependencies | ajv, semver, lodash.merge, @typescript-eslint/utils, @typescript-eslint/parser, @typescript-eslint/typescript-estree, json-stable-stringify-without-jsonify |
| Status | LEGITIMATE — proceeded with install |

## Verification results

| Check | Outcome |
|-------|---------|
| `bun install --frozen-lockfile` | Idempotent (Checked 228 installs, no changes) |
| `bunx tsc --noEmit -p packages/eslint-plugin/tsconfig.json` | Exit 0, zero `error TS` |
| `bun test packages/eslint-plugin/tests/no-number-for-money.test.ts` | 8 pass / 0 fail (4 valid + 4 invalid cases) |
| `bun run lint` from repo root | Exit 0, zero violations |

### RuleTester cases (all passing)

**Valid (rule must NOT fire):**
1. `const count: number = 0;`
2. `const attemptCount: number = 0;`
3. `function get(index: number) { return index; }`
4. `interface Pagination { pageIndex: number; totalCount: number; multiplier: number; }`

**Invalid (rule must fire):**
1. `const balance: number = 100;`
2. `function placeBet(betAmountCents: number) { return betAmountCents; }`
3. `interface CashoutResult { payout: number; }`
4. `class Wallet { wagerCents: number = 0; }`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Bun did not symlink `@crash/eslint-plugin` into `node_modules/`**

- **Found during:** Task 3 (first `bun run lint` invocation failed with `ERR_MODULE_NOT_FOUND` on `@crash/eslint-plugin`).
- **Issue:** Bun only materializes workspace packages into `node_modules/@scope/` when something depends on them. Nothing in the workspace tree declared a dep on `@crash/eslint-plugin`, so the symlink was missing and ESLint (running under Node) could not resolve the plugin import in `eslint.config.js`.
- **Fix:** Added `"@crash/eslint-plugin": "workspace:*"` to root `devDependencies` and re-ran `bun install`. Symlink `node_modules/@crash/eslint-plugin -> ../../packages/eslint-plugin` now exists.
- **Files modified:** `package.json`, `bun.lock`
- **Commit:** 6357585

**2. [Rule 3 — Blocking] Node ESM loader rejected extensionless `.ts` barrel import**

- **Found during:** Task 3 (lint still failed after symlink fix with `ERR_MODULE_NOT_FOUND` on `./rules/no-number-for-money`).
- **Issue:** `src/index.ts` originally did `import { noNumberForMoney } from "./rules/no-number-for-money";`. Under Bun this resolves fine, but ESLint runs under Node, and Node 24's native TypeScript-stripping loader requires explicit file extensions on ESM specifiers.
- **Fix:** Changed the barrel import to `"./rules/no-number-for-money.ts"` and added `"allowImportingTsExtensions": true` to the package tsconfig so TypeScript still typechecks the import.
- **Files modified:** `packages/eslint-plugin/src/index.ts`, `packages/eslint-plugin/tsconfig.json`
- **Commit:** 6357585

**3. [Rule 3 — Blocking] Pre-existing `process.env` access in NestJS bootstrap entrypoints**

- **Found during:** Task 3 first clean lint pass.
- **Issue:** `services/games/src/main.ts` and `services/wallets/src/main.ts` were scaffolded in earlier phases to read `process.env.PORT` directly during `bootstrap()`. The new `no-restricted-properties` rule flagged both. The plan's lint-clean criterion conflicts with the existing scaffold.
- **Fix:** Added `services/*/src/main.ts` to the exemption file-glob alongside `**/src/config/**/*.ts` and `**/mikro-orm.config.ts`. Rationale: NestJS bootstrap must read PORT BEFORE the AppModule (and thus the typed config layer) is instantiated, so this single env access is unavoidable at the entry point. The exemption is surgical (only `main.ts`, only inside `services/*/src/`), not a blanket disable.
- **Files modified:** `eslint.config.js`
- **Commit:** 6357585
- **Note for P1.7:** When the typed config layer lands, `main.ts` should switch to `const port = env.PORT;` using the zod-validated `env` export and the exemption may be removed.

**4. [Rule 3 — Blocking] Node warned about typeless package.json for ESM eslint.config.js**

- **Found during:** Task 3 (lint passed but emitted a `MODULE_TYPELESS_PACKAGE_JSON` warning on every invocation).
- **Issue:** `eslint.config.js` uses `export default`, but root `package.json` had no `"type": "module"`, so Node reparsed the file as ESM after detecting syntax — costing a perf hit and emitting noise.
- **Fix:** Added `"type": "module"` to root `package.json`. Safe addition: there are no other `.js` files at the repo root (all source is `.ts` and tooling is invoked via `bunx`).
- **Files modified:** `package.json`
- **Commit:** 6357585

## Known false-negative patterns (for ADR-006)

- **Identifier rename to a non-money word:** `const totalAmount: number` is flagged; `const total: number` is not. Mitigation: code review.
- **Non-PascalCase suffix camelCasing inside a longer identifier:** the regex only matches `amount`/`Amount` boundaries; `subamount` (no boundary) would NOT match. Mitigation: stick to camelCase identifiers (project convention).
- **Type indirection:** `type Cents = number; const balance: Cents = 100` is NOT flagged because the rule only checks `TSNumberKeyword` and `TSTypeReference -> Number`. Phase 4 will add type-aware checking once `Money` and `Multiplier` VOs are the canonical types.
- **`Multiplier` semantics deferred:** `multiplier: number` is intentionally allowed in Phase 1; the dedicated VO arrives in Phase 4 alongside an extended rule.

## Commit log

| Task | Type | Commit |
|------|------|--------|
| 1 (slopcheck) | docs-only verification, no commit | — |
| 2 (plugin + tests) | feat | 310a703 |
| 3 (root config + Prettier + workspace fixups) | feat | 6357585 |

## Self-Check: PASSED

- packages/eslint-plugin/package.json — FOUND
- packages/eslint-plugin/tsconfig.json — FOUND
- packages/eslint-plugin/src/index.ts — FOUND
- packages/eslint-plugin/src/rules/no-number-for-money.ts — FOUND
- packages/eslint-plugin/tests/no-number-for-money.test.ts — FOUND
- packages/eslint-plugin/tests/fixtures/positive/{balance-as-number,bet-amount-cents,interface-payout}.ts — 3/3 FOUND
- packages/eslint-plugin/tests/fixtures/negative/{count-as-number,index-as-number}.ts — 2/2 FOUND
- eslint.config.js — FOUND
- .prettierrc — FOUND
- .prettierignore — FOUND
- Commit 310a703 — FOUND in git log
- Commit 6357585 — FOUND in git log
