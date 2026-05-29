# Phase 07 — Deferred Items

## Pre-existing (out of scope for 07-01)

- **8 failing unit tests in `services/games/tests/unit`** — present at baseline commit `bf1100d` BEFORE any 07-01 change. Failures are `serverTime` / clock-mocking mismatches (e.g. `get-ws-snapshot.use-case.test.ts:111` expects `now.getTime()` but receives wall-clock `Date.now()`), unrelated to the WS schema relocation. The `GetWsSnapshotUseCase` reads real wall-clock time instead of the injected `Clock` for `serverTime`. Verified identical pass/fail counts (213 pass / 8 fail) with and without 07-01 changes via `git stash` comparison. Defer to the verifier / a games-clock-injection fix.

## Out-of-scope lint findings (discovered during 07-05)

- `frontend/src/lib/config.ts:30` — `@crash/no-number-for-money` flags `minCents`/`maxCents` on the `bet` config shape (`{ minCents: number; maxCents: number }`). Introduced in 07-04, not a file touched by 07-05. The bet-amount validator consumes them only to build `Money.of(BigInt(...))`, so no money value is ever a `number` downstream. Resolution candidates: rename the keys (e.g. `minBetCents`/`maxBetCents`) or scope an eslint exception for cents-config bounds.
- `frontend/src/routeTree.gen.ts:1` — unused eslint-disable directive in the TanStack-Router generated file; regenerated artifact, not hand-edited.
