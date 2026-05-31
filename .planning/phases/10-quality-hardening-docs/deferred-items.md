# Deferred Items — Phase 10

Items discovered during execution that are OUT OF SCOPE for the current task.

---

## 2026-05-31 — Pre-existing integration-test boot failure

**Discovered during:** Plan 10-05 Task 1 (creating `tests/integration/metrics-endpoint.test.ts`).

**Symptom:** Booting `AppModule` from `@nestjs/testing` via `Test.createTestingModule({ imports: [AppModule] }).compile()` fails with:

> Nest can't resolve dependencies of the MultiplierBroadcastService (?, Object, EventEmitter). Please make sure that the argument at index [0] is available in the current module.

**Repro:** `cd services/games && INTEGRATION=1 bun test tests/integration/leaderboard-projector-chaos.test.ts` (a Phase 9 SC5 test) fails identically. The same is observed in `ws-snapshot.test.ts`. Same path used by the new `metrics-endpoint.test.ts`.

**Root cause hypothesis:** `MultiplierBroadcastService` uses constructor overloading — the runtime constructor takes `(ModuleRef | RoundLoopService, EventEmitter2 | GameWsGateway, EventEmitter2?)`. Nest test-bed cannot resolve `ModuleRef` as a 1st arg in the overload position when reflection only sees the LAST signature's metadata. The break was introduced when commit `a957c8b fix(06-09): break RoundLoop-MultiplierBroadcast DI cycle via ModuleRef` added the overload.

**Why it doesn't block production:** `bun run docker:up` boots the games service via `bun run src/main.ts`, which uses the standard `NestFactory.create(AppModule)` flow. That path resolves `ModuleRef` correctly because reflection runs against the actual decorated parameter list at construction time, not the TS overload union. Live containers are healthy.

**Why deferred:** Out of scope for plan 10-05 (custom Prometheus metrics + `/metrics` endpoint). Live `/metrics` is verified directly against running containers via `curl`. Fixing the DI overload pattern is its own architectural touch on Phase 6 code.

**Recommended fix (future plan):** Replace the overloaded constructor in `MultiplierBroadcastService` with a single constructor taking `(ModuleRef, EventEmitter2)` and drop the test-friendly direct-deps overload. Update `multiplier-broadcast-round-tick.test.ts` (the only unit test using the direct form) to construct via a fake `ModuleRef`. Once landed, all 3 currently-broken integration tests pass without further change.

---

## 2026-05-31 — Pre-existing wallets integration boot failure

**Discovered during:** Plan 10-05 Task 1 (creating `services/wallets/tests/integration/metrics-endpoint.test.ts`).

**Symptom:** `pino-pretty` transport unresolvable when `Test.createTestingModule({ imports: [AppModule] })` boots in test env.

> error: unable to determine transport target for "pino-pretty"

**Repro:** Existing test `services/wallets/tests/integration/jwt-guard.test.ts` fails identically — same boot path, same error.

**Root cause:** `buildPinoOptions` (`services/wallets/src/observability/pino-config.ts`) configures `pino-pretty` transport in dev. Under Bun's module resolver during `bun test`, the transport thread cannot locate `pino-pretty` as a worker dependency.

**Why deferred:** Pre-existing — all current wallets integration tests are equally affected. Out of scope for 10-05. Live containers verified directly via `curl`.

**Recommended fix:** Either gate `pino-pretty` transport behind `NODE_ENV !== "test"`, or move the `pretty` transport to a peer dependency of the wallets test boot helper.

---

## 2026-05-31 — RESOLVED — FE runtime error: node:crypto externalized

**Status:** Fixed. The leak was `@crash/shared-kernel` root barrel re-exporting `identity/mask-player-id.ts`, which imported `node:crypto`. The frontend (`leaderboard-panel.tsx`) imported `maskPlayerId` from the root barrel, dragging `node:crypto` into the browser bundle; Vite externalized it and the React tree crashed at first call.

**Fix applied:**
- Subpath isolation: `@crash/shared-kernel/identity` now exposes branded IDs + `maskPlayerId`. Root barrel exposes only `money` / `errors` / `events` / `config/env-schema` (all browser-safe).
- `maskPlayerId` rewritten to an isomorphic pure-JS SHA-256 (`src/identity/sha256.ts`) so the same implementation runs in Node and browser without `node:crypto`. The existing cross-environment determinism gate test still passes against the `node:crypto.createHash` reference.
- Regression test `packages/shared-kernel/tests/root-barrel-browser-safe.test.ts` walks the static import graph reachable from the root barrel and fails if any file reaches `node:crypto`, `node:fs`, `createHash`, `createHmac`, etc.
- All 71 backend + FE consumers re-routed to import identity types/funcs from `@crash/shared-kernel/identity`.

**Verification:** Fresh Vite dev boot produces zero `externalized` / `node:crypto` log lines; `curl /` returns 200 with full SSR HTML; FE vitest suite 247/247 green; shared-kernel / games / wallets / frontend typechecks all clean.

---

## 2026-05-31 — Frontend vitest regression: 147 failing / 2 errors (out of scope for 10-07)

**Discovered during:** Plan 10-07 Task 1 — running `cd frontend && bun test` to validate that adding `data-testid` attributes did not regress the unit suite.

**Symptom:** `cd frontend && bun test` reports **80 pass / 147 fail / 2 errors / 227 tests across 37 files** on `main@7e3b807`. Failures pre-date plan 10-07 — the previously-recorded "247/247 green" figure (above, in the resolved `node:crypto` entry) no longer holds.

**Verification that plan 10-07 introduced no regression:**
- Baseline (no edits): `git stash && bun test` → 80 pass / 147 fail / 2 errors.
- With 10-07 edits (testids + `bet.store.lastOutcome`): `bun test` → 80 pass / 147 fail / 2 errors.
- Identical counts; my edits are byte-stable.

**Failure categories observed (sample):**
- `replay.store` selectors (e.g. `selectIsReplayOpen`) returning `false` where the test expected `true` — store-shape vs test-shape drift.
- 2 suite-load errors — likely import/path drift.

**Why deferred:** Plan 10-07 explicitly scopes Playwright E2E specs against the **live docker stack** for REQ-TEST-05. Vitest unit-suite repair is independent.

**Recommended fix (future plan):** Triage the replay-store selectors first — a single shape fix likely cascades to many of the 147 fails. Then re-baseline.

## 10-09: Pre-existing root tsconfig.json missing — RESOLVED (CI hotfix)

- **Discovered:** plan 10-09 verification
- **Issue:** root `package.json` defines `typecheck: tsc --noEmit -p tsconfig.json` but no `tsconfig.json` existed at repo root
- **Resolution:** Added minimal noEmit `tsconfig.json` at repo root that typechecks `scripts/**/*.ts`. `bun run typecheck` exits 0.

---

## 2026-05-31 — Games unit baseline: 4 clock-mock fails (pre-existing)

**Discovered during:** CI green-run hotfix (post plan 10-09).

**Status:** Baseline. The 5th fail (pino-pretty transport) was fixed alongside the CI hotfix; the remaining 4 pre-date Phase 10 and depend on fake-timer / DI-mock refactors.

**Currently failing in `cd services/games && bun test tests/unit`:**

1. `RoundLoopService > no open round → bootstrap starts a new BETTING round`
2. `RoundLoopService > recovery from BETTING with bettingEndsAt in the past → transitions to RUNNING`
3. `RoundLoopService > OnApplicationShutdown clears the pending timer and halts scheduling`
4. `RoundLoopService > bootstrap → startNewRound emits round.started with payload matching the new round`
5. `GetWsSnapshotUseCase > snapshot during BETTING with no bets`

(Counts can fluctuate 4–5 depending on a flaky bootstrap timer race; the steady-state is 4.)

**Root cause hypothesis:** `RoundLoopService` constructor scheduling interacts with `bun:test`'s default timer model. The bootstrap path retries on a 1000ms timer, and the tests don't advance fake timers consistently. `GetWsSnapshotUseCase` failure is a mock-shape drift — `bets.getRollingRtp` is undefined on the test double, surfacing as a warning that the test then asserts against.

**Why deferred:** Out of scope for the CI hotfix (fix typecheck + lint + 1 pino test). Repairing the clock model requires touching the RoundLoopService DI test rig, which is its own focused refactor.

**Recommended fix (future plan):** Stub `Date.now` + use `bun:test` `setSystemTime` consistently across the 4 RoundLoopService tests; extend the bets repo mock with `getRollingRtp` for the snapshot test.

---

## 2026-05-31 — Pino-pretty transport test alignment — RESOLVED (CI hotfix)

- **Discovered:** CI hotfix run.
- **Issue:** `services/games/tests/unit/observability/pino-config.test.ts` asserted `transport === { target: "pino-pretty" }` whenever `NODE_ENV !== "production"`, but commit `9404baa` (Phase 10-05) gated the transport behind `PINO_PRETTY=1` to stop `bun test` from crashing on missing worker resolution.
- **Resolution:** Test now asserts the env-gated behavior — pretty transport iff `NODE_ENV !== "production" && PINO_PRETTY === "1"`. Three explicit cases (gated-on, gated-off, prod-overrides-flag). All 6 pino-config assertions pass.
