# ADR-003: Bun + NestJS pinning strategy

**Status**: Accepted
**Date**: 2026-05-24
**Phase**: 1

## Context

Bun 1.3.10 introduced a regression where `emitDecoratorMetadata: true` was interpreted under TC39 standard decorator semantics instead of legacy semantics, breaking every NestJS controller decorator (`@Controller`, `@Get`, `@Post`, ...) with `descriptor.value is undefined`. The regression is tracked at [oven-sh/bun#27526](https://github.com/oven-sh/bun/issues/27526) and was fixed in Bun 1.3.11 ([Bun blog v1.3.11](https://bun.com/blog/bun-v1.3.11)).

The provided scaffold pinned the Docker base image to `oven/bun:1-alpine`, a floating tag that resolves to whatever 1.x.y is current at pull time. A `docker compose up` between two days could silently upgrade the runtime — and a future minor regression would surface as broken controllers, a broken DI graph, or worse, as a subtle metadata-emission shift that breaks MikroORM entity mapping.

REQ-INFRA-04 calls for explicit version pinning (`.bun-version`, lockfiles). The decision is how strict to be: pin exact `1.3.11`, pin `>=1.3.11`, or stay on the floating `1.3` tag.

The decision must also cover the TypeScript decorator-metadata flags themselves. Bun's interpretation of `emitDecoratorMetadata: true` changed between 1.3.10 and 1.3.11 — relying on tsconfig inheritance from a root file invites the same regression on the next Bun bump.

## Considered

- **Pin exact `1.3.11`** in `.bun-version`, `package.json#packageManager`, and `oven/bun:1.3.11-alpine` in every Dockerfile. Explicit `emitDecoratorMetadata: true` AND `experimentalDecorators: true` in every service `tsconfig.json` (not inherited from root).
- **Pin minor `>=1.3.11`** — accepts patch upgrades automatically. Lower friction for security patches, higher risk of a future regression.
- **Stay on `1.3` floating tag** — current scaffold default. Cheapest to maintain, highest risk. Already burned us once (the 1.3.10 → 1.3.11 transition).

## Decision

**Exact pin to Bun 1.3.11.** Concretely:

- `.bun-version` at the repo root contains the literal string `1.3.11` (no range, no caret).
- Root `package.json` declares `"packageManager": "bun@1.3.11"` for downstream tools that read the field.
- Every service Dockerfile uses `FROM oven/bun:1.3.11-alpine AS <stage>` for every stage (per RESEARCH §Pattern 2). No floating tag anywhere.
- Every service's `tsconfig.json` sets **both** `emitDecoratorMetadata: true` AND `experimentalDecorators: true` **explicitly** (not via inheritance). The flags document intent and survive Bun upgrades that might re-interpret defaults.

Rationale, per RESEARCH §Pitfall 2 and §Pitfall 5: the 1.3.10 regression demonstrated that Bun's reaction to `emitDecoratorMetadata: true` can change between minor versions. Exact pinning makes upgrades a deliberate, searchable action — every `1.3.11` literal in the repo is `grep`-replaceable in one pass, and the change shows up in a single commit during code review. Floating tags hide upgrades inside `docker pull`, where they cannot be reviewed.

Explicit per-service tsconfig flags are the defense in depth: even if a future Bun release re-interprets defaults, the flags are present in the file and the team's intent is documented.

## Consequences

- **Locked in**: every Bun upgrade is a deliberate, reviewable code change touching `.bun-version`, `packageManager`, and N Dockerfiles. Phase 10 CI uses the same pinned image. The 1.3.11 literal is greppable across the entire repo for future bumps.
- **Foreclosed**: silent Bun upgrades via floating Docker tags; tsconfig inheritance from a root file for decorator flags; per-service drift in decorator-metadata configuration.
- **Friction accepted**: security patches for Bun require a manual bump. The trade-off is acceptable because the alternative (floating tags) already broke us once and the scoring band penalizes operational instability.
- **Anticipated recruiter question**: "Why exact pinning instead of a caret range?" — defended by the 1.3.10 regression as concrete evidence; ranges allow exactly the silent upgrade we are blocking.

## Alternatives Rejected

- **Pin minor `>=1.3.11`** — accepts the next regression silently; defeats the reason we are pinning.
- **Stay on floating `1.3` tag** — current scaffold default; already burned us via the 1.3.10 → 1.3.11 transition.
- **Inherit decorator flags from root tsconfig** — vulnerable to the same Bun-default-re-interpretation that 1.3.10 demonstrated; explicit per-service flags are cheap insurance.
