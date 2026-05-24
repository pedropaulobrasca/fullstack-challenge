# ADR-006: ESLint money-guard plugin location and authoring approach

**Status**: Accepted
**Date**: 2026-05-24
**Phase**: 1

## Context

REQ-DOM-06 requires that monetary identifiers use the `Money` value object (ADR-002), not raw `number`. The CLAUDE.md project guide promises "ESLint custom rule (added in Phase 1) bans `number` on symbols matching `/amount|balance|bet|payout|price|wager/i`. Do not disable it." The enforcement vector is therefore an ESLint rule — and the open sub-decisions are (a) where the rule lives in the repository and (b) how the rule is authored.

The rule needs to run across both services and the frontend, so it must be consumable from a root flat config (ESLint 9). It must also be testable in isolation with fixture-driven positive and negative cases so that regressions in the regex or the AST walk are caught before they ship.

## Considered

Sub-decision (a): rule location.

- **Inline in `eslint.config.js`** — no package boundary; the rule's `create` function is defined inline. Zero file-system overhead. No place to put tests; no clean way to version the rule alongside dependent ADRs.
- **Workspace package `packages/eslint-plugin`** — Bun workspace package consumed from the root flat config via `import crashPlugin from "@crash/eslint-plugin"`. Tests live next to the rule (`packages/eslint-plugin/tests/`). Future custom rules co-locate by dropping new files in `src/rules/`.
- **Repo-local non-package directory `tools/eslint-plugin`** — files live in the repo but not as a workspace package. Loses Bun's workspace symlink resolution; consumer code has to use a relative path that becomes a maintenance hazard during refactors.

Sub-decision (b): authoring style.

- **Hand-rolled `module.exports = { rules: { ... } }`** — minimal dependency surface; no types on `context`, no doc-URL helper, no `AST_NODE_TYPES` enum for AST checks.
- **`@typescript-eslint/utils` `ESLintUtils.RuleCreator`** — typed `context`, automatic doc-URL helper, ergonomic `meta` validation, `AST_NODE_TYPES` enum for safer AST node-type checks. Paired with `@typescript-eslint/rule-tester` for fixture-driven tests. Matches typescript-eslint 8.x current guidance.

## Decision

**(a) Workspace package `packages/eslint-plugin`** consumed from the root `eslint.config.js` flat config via `import crashPlugin from "@crash/eslint-plugin"`. The package exposes a default export `{ rules: { "no-number-for-money": ... } }` and is registered in the flat config as `plugins: { "@crash": crashPlugin }` with the rule turned on via `rules: { "@crash/no-number-for-money": "error" }`.

**(b) Author the rule with `@typescript-eslint/utils` `ESLintUtils.RuleCreator`.** Tests use `@typescript-eslint/rule-tester` with fixture files in `packages/eslint-plugin/tests/fixtures/` split into `positive/` (expected violations) and `negative/` (must not flag).

Rationale, per RESEARCH §Output §6 (lines 1038-1049) and §Code Examples (lines 668-738): the workspace-package layout gives the rule a place to grow (Phase 4 will likely add a "no `Date.now()` for round timestamps" rule, Phase 5 will add a "no direct `process.env` outside `config/`" hardener, etc.) without bloating the root config. `ESLintUtils.RuleCreator` is the current typescript-eslint canonical authoring path; it removes the boilerplate of typing `context` by hand and gives the rule a doc URL slot that recruiters can follow during arguição.

The rule matches identifiers by name pattern: `/^(amount|balance|bet|payout|price|wager|cents|money|fee|stake|win|loss)$|^(.+(?:Amount|Balance|Bet|Payout|Price|Wager|Cents|Money|Fee|Stake|Win|Loss))$/`. It checks `VariableDeclarator`, function parameter `Identifier`, `TSPropertySignature`, and `PropertyDefinition` AST nodes for a `TSNumberKeyword` (or `Number` reference) type annotation.

## Consequences

- **Locked in**: `packages/eslint-plugin` is the home for project-specific lint rules; new rules ship as new files under `src/rules/` with co-located tests; root `eslint.config.js` consumes the package as a flat-config plugin.
- **Foreclosed**: inline rule definitions in `eslint.config.js`; hand-rolled rule authoring without typed `context`; rule files living outside a workspace package.
- **Known limitation accepted**: the rule matches identifier **names**, not inferred types. A developer who renames `totalAmount: number` to `total: number` evades the rule. The mitigation is code review — name-based detection catches the >90% of cases without the complexity cost of full TypeScript type-flow analysis. A future rule could integrate `@typescript-eslint/type-utils` to follow type aliases back to `number`, but the cost of that complexity exceeds the marginal recall gain.
- **Tests are part of the package**: every rule ships with positive and negative fixtures, run as part of the standard test command.
- **Phase 1 ships**: `packages/eslint-plugin/package.json`, `tsconfig.json`, `src/rules/no-number-for-money.ts`, `src/index.ts`, `tests/no-number-for-money.test.ts`, and the fixture files. The root `eslint.config.js` registers the plugin.

## Alternatives Rejected

- **Inline rule in `eslint.config.js`** — no test harness; no growth path for additional rules; couples rule logic to the root config file.
- **Hand-rolled `module.exports = { rules }`** — no type safety on `context`; no doc-URL helper; misaligned with current typescript-eslint 8.x guidance.
- **Repo-local non-package directory `tools/eslint-plugin`** — loses workspace symlink resolution; consumer paths fragile to refactors.
