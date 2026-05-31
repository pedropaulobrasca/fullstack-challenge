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

## 2026-05-31 — Pre-existing FE runtime error: node:crypto externalized

**Discovered during:** Plan 10-06 Task 1 (visual verification of D-03a fix via Playwright).

**Symptom:** Fresh Playwright context navigates to http://localhost:3000, OIDC redirect completes, header renders (CRASH logo + Fairness badge + Reconnecting pill), but the rest of the React tree never mounts. Browser console:

> Module "node:crypto" has been externalized for browser compatibility. Cannot access "node:crypto.createHash" in client code.

**Where:** Some client-bundled module imports `node:crypto` directly (likely a Phase 8 fairness helper that should use `crypto.subtle` or the `provably-fair-browser` entry from `@crash/contracts`). Vite externalizes `node:` builtins for browser, causing a runtime throw the first time the path is exercised.

**Impact on plan 10-06:** Blocks live click-through screenshot capture for D-03a (Sheet/Dialog visual confirm). The CSS fix itself is correct — verified at the build-artifact layer:
- `globals.css` now contains `@import "tw-animate-css";` after `@import "tailwindcss";` (regression test: `src/styles/globals.css.test.ts`).
- Compiled CSS served by Vite contains all four animation utilities the diagnosis cited (`animate-in`, `slide-in-from-right`, `fade-in-0`, `zoom-in-95`) and the `--tw-enter-*` CSS variables emitted by `tw-animate-css@1.4.0`.

**Out of scope** for 10-06 (which addresses 3 polish defects, not Phase 8 SSR/browser-bundle hygiene). Should be addressed in plan 10-07 (Playwright E2E) or a follow-up fix plan — the bundler hygiene fix is "find the import and route it through `provably-fair-browser`."
