# Phase 07 — Deferred Items

## Pre-existing (out of scope for 07-01)

- **8 failing unit tests in `services/games/tests/unit`** — present at baseline commit `bf1100d` BEFORE any 07-01 change. Failures are `serverTime` / clock-mocking mismatches (e.g. `get-ws-snapshot.use-case.test.ts:111` expects `now.getTime()` but receives wall-clock `Date.now()`), unrelated to the WS schema relocation. The `GetWsSnapshotUseCase` reads real wall-clock time instead of the injected `Clock` for `serverTime`. Verified identical pass/fail counts (213 pass / 8 fail) with and without 07-01 changes via `git stash` comparison. Defer to the verifier / a games-clock-injection fix.
