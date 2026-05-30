
## 09-07 deferred — pre-existing integration test bootstrap baseline failure

When run with `INTEGRATION=1`, `createTestGamesApp` (in `tests/integration/_helpers/app-factory.ts`) cannot resolve `MultiplierBroadcastService` at index [0] (the `ModuleRef` ctor arg added by Phase 6 P6.05 to break the RoundLoop ↔ MultiplierBroadcast cycle). This same failure reproduces against `tests/integration/get-player-bets.test.ts` and `tests/integration/leaderboard-repository.test.ts` on `main` BEFORE the 09-07 changes — so it is a pre-existing baseline regression in the bun-test Nest DI path, not introduced by this plan.

`leaderboard-controller.test.ts` compiles cleanly, runs under bun-test, and hits the same DI baseline as its siblings. tsc is green; the controller, use case, and DTOs all behave correctly under the use-case unit suite (4/4 pass) + DTO unit suite (5/5 pass).

Out of scope per SCOPE BOUNDARY (not caused by current task's changes). Should be addressed in a follow-up plan that audits `app-factory.ts` and the DI graph for the games integration bootstrap.
