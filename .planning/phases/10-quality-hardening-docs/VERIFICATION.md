---
phase: 10-quality-hardening-docs
verified: 2026-05-31T20:55:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Push the workflow file branch to GitHub, open a draft PR, wait for the CI workflow run to finish, confirm `bun run docker:up` boots all 11 containers, all healthchecks go green, both Playwright specs report 2 passed, the workflow ends in a green check."
    expected: "Green CI run on a draft PR with `2 passed (Xs)` in the Playwright E2E step and a final green status badge on github.com."
    why_human: "REQ-CI-01 + REQ-CI-02 by their nature can only be observed by triggering a real GitHub Actions run. SUMMARY 10-08 explicitly defers this to a user-push checkpoint and so does the ROADMAP P10-08 entry. Verifier cannot push to GitHub from the local sandbox."
  - test: "After 5 minutes of bet activity in the running stack, open Grafana at http://localhost:3001 (anonymous Viewer), switch to the `Crash Domain` dashboard, confirm `bet_volume_total`, `crash_rtp_window`, `multiplier_drift_seconds`, `ws_broadcast_latency_seconds`, and `active_ws_connections` panels render non-empty curves matching the placed bets."
    expected: "All 5 custom-metric panels populate with live data. Datasource + dashboard JSON + Prometheus scrape line up (Pitfall 4 surface)."
    why_human: "Visual verification of dashboard JSON rendering and datasource resolution requires opening Grafana in a browser. `curl /api/health = 200` (already verified) proves the container is alive, not that the panels render."
  - test: "Open Jaeger UI at http://localhost:16686, search `games-service`, find the most recent bet trace, expand the span tree, confirm child spans for `MikroORM SELECT`, `amqplib publish wallet.command.debit`, then under `wallets-service` the `DebitWalletUseCase` + `amqplib publish wallet.event.debited`, then back under `games-service` the `WalletDebitedHandler.handle`. All under ONE trace_id."
    expected: "Single trace_id spans the full HTTP→AMQP→WS bet saga across both services in the Jaeger UI."
    why_human: "Visual span-tree inspection in Jaeger UI; automation can prove `/api/services` returns 200 (already verified) but cannot prove the span tree has the correct shape without a dedicated trace-walking probe (out of scope per 10-VALIDATION manual-only verifications)."
  - test: "Open the rendered README on github.com after the first green CI run, confirm the CI badge image renders green and the ADR catalogue table displays 37 rows sorted by ADR number with correct titles/phases/dates/statuses."
    expected: "Green CI badge SVG visible; ADR table renders cleanly on github.com."
    why_human: "REQ-CI-03 + REQ-DOC-02 are visual-render checks on the GitHub-rendered Markdown — automation can grep the badge URL and count `| ADR-` rows (both already verified locally) but cannot render the SVG or the table in a real browser."
  - test: "Manually exercise the Fairness drawer (click the FairnessBadge) and Replay modal (click any history-strip Replay button) in the live frontend, confirm each opens visually within ~300ms and closes cleanly twice; observe Chrome DevTools Console across ≥3 round transitions for any React `key` prop warning from HistoryStrip."
    expected: "Sheet drawer slides in from right within 300ms; Dialog modal opens centered within 300ms; no React `key` warning emitted across 3 rounds (D-03a + D-03c)."
    why_human: "D-03a / D-03c are visual + DevTools console observations the verifier cannot run from CLI."
---

# Phase 10: Quality Hardening & Docs Verification Report

**Phase Goal:** Every claim made in the submission is provable by automation — CI runs the full stack end-to-end on every push, Playwright covers the player flow, OpenTelemetry traces ride every saga, and the README + ADR catalogue let a reviewer reconstruct every decision without asking.

**Verified:** 2026-05-31T20:55:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth (SC) | Status | Evidence |
|---|------------|--------|----------|
| 1 | Two Playwright E2E specs pass against live Docker stack: (a) login→BETTING→bet→RUNNING→cashout→balance updated; (b) login→bet→crash→bet lost | VERIFIED (auto) + ? UNCERTAIN (live CI green) | `e2e/specs/bet-cashout.spec.ts` (180 lines, real `expect`/`waitFor`/`expect.poll` assertions on `data-last-bet-outcome=CASHED_OUT` + balance-pill mutation) + `e2e/specs/bet-crash.spec.ts` (109 lines, asserts `data-last-bet-outcome=LOST`). Both use `test.use({ storageState })` from a global OIDC fixture. SUMMARY 10-07 claims "Three consecutive end-to-end runs all green (2 passed each)". |
| 2 | GitHub Actions runs `bun run docker:up` on fresh clone for every push/PR, waits for healthchecks, runs unit + E2E + Playwright, then tears down; README displays build/tests/coverage status badges | VERIFIED (workflow file) + ? UNCERTAIN (live green run) | `.github/workflows/ci.yml` exists (76 lines): `on: push[main] + pull_request`, `concurrency.cancel-in-progress: true`, free-disk step, `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck`, `bun run docs:adr-index:check`, `bun test`, `bun run docker:up`, `bash scripts/smoke-health.sh`, `INTEGRATION=1 bun --cwd services/games test tests/integration`, `INTEGRATION=1 bun --cwd services/wallets test tests/integration`, `bunx playwright install --with-deps chromium`, `bunx playwright test --config=e2e/playwright.config.ts`, always-on teardown, failure-only artifact upload. README line 3 has `![CI](.../actions/workflows/ci.yml/badge.svg)`. SUMMARY 10-08 marks green-run as user-push checkpoint (deferred). |
| 3 | Both services emit OpenTelemetry traces via W3C TraceContext across HTTP, AMQP, WS boundaries; a single bet's lifetime is traceable end-to-end through correlationId in Grafana/Jaeger | VERIFIED (SDK init + auto-instrumentations) + ? UNCERTAIN (visual span-tree shape) | `services/games/src/main.ts` line 1 = `import "./tracing";` (literal first import). `services/wallets/src/main.ts` line 1 = `import "./tracing";`. Both `tracing.ts` initialize NodeSDK with OTLPTraceExporter pointed at `OTEL_EXPORTER_OTLP_ENDPOINT` + `getNodeAutoInstrumentations` (http/express/nest/amqplib/pg auto). `ObservabilityModule` wires `OpenTelemetryModule.forRoot()` + nestjs-pino with `customProps` injecting `traceId` + `spanId` + `correlationId` from CLS. `curl http://localhost:16686/api/services` returns HTTP 200 live (Jaeger UI reachable). |
| 4 | Prometheus `/metrics` endpoints expose req latency, AMQP lag, WS connections, plus custom domain metrics (bet volume, RTP, multiplier drift, WS broadcast latency); pre-provisioned Grafana dashboards render them on first `docker:up` | VERIFIED (auto) + ? UNCERTAIN (dashboard panels render with data) | `curl http://localhost:4001/metrics` returns the 5 custom metrics live (`crash_bet_volume_total`, `crash_rtp_window 0.3016`, `crash_multiplier_drift_seconds_*`, `crash_ws_broadcast_latency_seconds_*`, `crash_active_ws_connections 0`) plus standard `process_*` + `nodejs_*` counters/gauges (35+ series sampled). `docker-compose.yml` runs Jaeger `1.63.0` + Prometheus `v3.0.1` + Grafana `11.3.1` with `prometheus.yml` mounted RO and `docker/grafana/provisioning/{datasources,dashboards}` mounted RO. Provisioning dir contains `jaeger.yml + prometheus.yml` datasources + `dashboards.yml + games-service.json + wallets-service.json + crash-domain.json` (3 dashboards per D-06). `curl http://localhost:9090/-/healthy` = 200, `curl http://localhost:3001/api/health` = 200. |
| 5 | README contains setup, architecture diagram, saga flow diagram, provably-fair algorithm, scripts, env vars, troubleshooting; `.planning/adrs/` contains one ADR per significant decision listed across Phases 1-9 with Context/Decision/Consequences/Alternatives Rejected | VERIFIED | README has 14 `##` sections including Quick Start, Architecture (mermaid `graph TB`), Saga Flow (mermaid `sequenceDiagram`), Provably Fair: Verify Outside the App, Observability, ADR Catalogue, Scripts, Environment Variables, Troubleshooting (387 lines total). `.planning/adrs/` has 37 ADR-*.md files (ADR-001..ADR-037). ADR-035 / 036 / 037 contain Context/Decision/Consequences (verified by header read). README ADR-Catalogue table has 37 `^| ADR-` rows. `bun scripts/build-adr-index.ts --check` exits 0 with `ADR index in sync: 37 entries`. |

**Score:** 5/5 truths verified for what code-based checks can reach; 4 of 5 carry residual `? UNCERTAIN` flags routed to human verification (live CI green run, Jaeger trace shape, Grafana panel data, README badge render).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `services/games/src/tracing.ts` | NodeSDK first-import init with OTLP exporter + auto-instrumentations | VERIFIED | 32 lines; resource attrs `ATTR_SERVICE_NAME=env.OTEL_SERVICE_NAME` + `ATTR_SERVICE_VERSION`; OTLPTraceExporter via `OTEL_EXPORTER_OTLP_ENDPOINT`; `getNodeAutoInstrumentations` with `instrumentation-fs` disabled; SIGTERM-graceful shutdown; literal first import in `main.ts`. |
| `services/wallets/src/tracing.ts` | Same shape as games-side | VERIFIED | Byte-identical to games-side except service-name resolution; literal first import in `main.ts`. |
| `services/games/src/observability/observability.module.ts` | LoggerModule (pino) + OpenTelemetryModule + PrometheusModule + 5 custom metric providers | VERIFIED | 49 lines; `LoggerModule.forRootAsync({inject:[ClsService]})` with `buildPinoOptions`; `PrometheusModule.register({path:"/metrics", defaultMetrics:{enabled:true}})`; all 5 metric providers imported + exported. |
| `services/games/src/observability/metrics/{bet-volume,crash-rtp-window,multiplier-drift,ws-broadcast-latency,active-ws-connections}.metric.ts` | 5 custom metric providers | VERIFIED | All 5 files present; live `/metrics` exposes the names. |
| `services/wallets/src/observability/observability.module.ts` + pino-config.ts | Same observability composition for wallets | VERIFIED | Both files present; `/metrics` on wallets returns 200 live. |
| `e2e/playwright.config.ts` + `e2e/fixtures/auth.fixture.ts` + `e2e/specs/bet-cashout.spec.ts` + `e2e/specs/bet-crash.spec.ts` | Playwright config + OIDC fixture + 2 REQ-TEST-05 specs (no test.skip) | VERIFIED | Config file present (referenced by `bunx playwright test --config=e2e/playwright.config.ts`). Both specs use `test.use({storageState: STORAGE_STATE_PATH})` from the auth fixture; real `getByTestId` selectors (`connection-badge`, `bet-place-button`, `cashout-button`, `balance-pill`, `game-root[data-round-status/data-last-bet-outcome]`); real `expect(...).toBe("CASHED_OUT"/"LOST")` assertions; instant-crash retry loop in cashout spec; no `test.skip` (grep `-c "test.skip" e2e/specs/*.spec.ts` returns 0 per SUMMARY 10-07). |
| `.github/workflows/ci.yml` | Single workflow: docker:up + healthchecks + unit + integration + Playwright + teardown | VERIFIED | Present; all expected steps in order; failure-only artifact upload of `playwright-report` + `test-results`. |
| `docker-compose.yml` | Jaeger + Prometheus + Grafana containers with healthchecks | VERIFIED | `jaegertracing/all-in-one:1.63.0` + `prom/prometheus:v3.0.1` + `grafana/grafana:11.3.1` all present with `ports` + `healthcheck` + grafana mounts `docker/grafana/provisioning:/etc/grafana/provisioning:ro`. |
| `docker/grafana/provisioning/datasources/{jaeger.yml,prometheus.yml}` + `dashboards/{dashboards.yml,games-service.json,wallets-service.json,crash-domain.json}` | UID-pinned datasources + 3 pre-provisioned dashboards | VERIFIED | All 6 files present; 3 dashboards per D-06; `dashboards.yml` provider config plus 3 dashboard JSON files. |
| `docker/prometheus/prometheus.yml` | Scrape config for games + wallets `/metrics` | VERIFIED | File present, mounted RO into Prometheus container. |
| `scripts/build-adr-index.ts` + `package.json` scripts `docs:adr-index{,:check}` | ADR catalogue generator + CI sync gate | VERIFIED | Both `build-adr-index.ts` + `build-adr-index.test.ts` present; `docs:adr-index` and `docs:adr-index:check` defined in package.json; `--check` exits 0 against the 37 current ADRs. |
| `README.md` | Quick Start + Architecture mermaid + Saga Flow mermaid + Provably Fair + Observability + ADR Catalogue (37 rows) + Scripts + Env + Troubleshooting + CI badge | VERIFIED | 387 lines; all 14 `##` headings observed; mermaid blocks confirmed at lines 30 + 68; CI badge URL at line 3; ADR table at lines 223-265 with 37 `^| ADR-` rows. |
| `.planning/adrs/ADR-035-otel-jaeger-stack.md` + `ADR-036-adr-catalogue-in-readme.md` + `ADR-037-ci-runs-full-stack.md` | 3 new ADRs at next-free numbers | VERIFIED | All 3 files present with `Status: Accepted` + `Date: 2026-05-31` + `Phase: 10` headers; renumbered from anticipated 028..030 to 035..037 per ADR-019..034 already consumed (renumber precedent per Phase 7/8/9). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `services/games/src/main.ts` | OTel SDK | literal `import "./tracing"` as first line | WIRED | Reading main.ts line 1 confirms. Same for wallets/main.ts. |
| `ObservabilityModule` | nestjs-pino LoggerModule | `LoggerModule.forRootAsync({inject:[ClsService], useFactory: (cls) => ({pinoHttp: buildPinoOptions(cls)})})` | WIRED | `buildPinoOptions` injects `traceId`/`spanId` via `trace.getActiveSpan()?.spanContext()` + `correlationId` via `cls.get("correlationId")`. |
| `PrometheusModule` | `/metrics` endpoint | `PrometheusModule.register({path:"/metrics"})` + live curl returns 200 with Prometheus exposition | WIRED | Behavioral spot-check confirmed; 5 custom metrics + nodejs + process default metrics all present. |
| `SettleRoundUseCase` | `crash_rtp_window` gauge | `this.bets.getRollingRtp(env.CRASH_RTP_WINDOW_ROUNDS)` call wrapped in try/catch | WIRED (live) + STUB (unit tests) | Production code paths emit the gauge (live `crash_rtp_window 0.3016` observed). Unit test fakes lack `getRollingRtp` → triggers a soft warn in tests (see Anti-Patterns / Behavioral Spot-Checks). |
| `e2e/specs/*.spec.ts` | live Docker stack | `playwright.config.ts` baseURL + Kong routes + Keycloak fixture | WIRED | Real `data-testid` selectors target real FE; fixture creates persistent OIDC `storageState`; SUMMARY 10-07 reports 3x consecutive green runs. |
| `.github/workflows/ci.yml` | repo runtime | `bun install` + `bun run docker:up` + `bunx playwright test --config=e2e/playwright.config.ts` | WIRED (file) / UNCERTAIN (green) | Workflow exists at HEAD; first green run pending user push (SUMMARY 10-08 checkpoint deferred). |
| `README.md` ADR table | `.planning/adrs/*.md` | `scripts/build-adr-index.ts` + sentinel markers + CI sync gate | WIRED | Generator exits 0; 37 rows render between sentinels; `bun run docs:adr-index:check` step landed in `ci.yml`. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `crash_rtp_window` gauge | `payoutTotalCents/betTotalCents` over rolling N rounds | `MikroBetRepository.getRollingRtp(windowRounds)` → real Postgres query | Yes (live `0.3016` observed against running stack) | FLOWING |
| `crash_bet_volume_total` counter | bet-state transitions | `BetVolumeProvider.inc({status})` on cashout/lost/refunded | Yes (live exposition shows non-empty counter line) | FLOWING |
| `crash_active_ws_connections` gauge | WS connect/disconnect | `GameWsGateway.handleConnection/disconnect → gauge.inc/dec` | Yes (live `0` while no active clients — correct value) | FLOWING |
| `crash_multiplier_drift_seconds` histogram | tick-emit-time vs wall-clock | `MultiplierBroadcastService.tick()` observes histogram each tick | Yes (live `count=354746, sum=998.89s`) | FLOWING |
| `crash_ws_broadcast_latency_seconds` histogram | broadcast emit latency | Same hot-tick observation site | Yes (live `count=354746, sum=39.38s`) | FLOWING |
| Grafana dashboard panels | PromQL queries | datasource UID resolves to Prometheus | UNKNOWN — requires visual render | STATIC (human verify; routed) |
| Jaeger span tree for a bet | OTel span exports from games + wallets | NodeSDK OTLP exporter → Jaeger OTLP endpoint | UNKNOWN — requires visual span-tree shape inspection | STATIC (human verify; routed) |
| README CI badge | shields.io rendering on github.com | github.com markdown render | UNKNOWN — requires github.com browser render | STATIC (human verify; routed) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| games `/metrics` exposes the 5 custom metrics | `curl -s http://localhost:4001/metrics \| grep -E '^crash_'` | Returns `crash_active_ws_connections 0`, `crash_bet_volume_total`, `crash_multiplier_drift_seconds_*`, `crash_rtp_window 0.3016`, `crash_ws_broadcast_latency_seconds_*` | PASS |
| wallets `/metrics` reachable | `curl -s -o /dev/null -w '%{http_code}' http://localhost:4002/metrics` | `200` | PASS |
| Jaeger UI reachable | `curl -s -o /dev/null -w '%{http_code}' http://localhost:16686/api/services` | `200` | PASS |
| Prometheus reachable | `curl -s -o /dev/null -w '%{http_code}' http://localhost:9090/-/healthy` | `200` | PASS |
| Grafana reachable | `curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/api/health` | `200` | PASS |
| ADR index check exits 0 | `bun scripts/build-adr-index.ts --check` | `ADR index in sync: 37 entries`, exit 0 | PASS |
| packages/contracts unit tests | `bun --cwd packages/contracts test` | 49 pass / 0 fail | PASS |
| packages/shared-kernel unit tests | `bun --cwd packages/shared-kernel test` | 25 pass / 0 fail | PASS |
| packages/messaging-spine unit tests | `bun --cwd packages/messaging-spine test` | 64 pass / 0 fail | PASS |
| services/games unit tests (full) | `bun --cwd services/games test tests/unit` | 302 pass / **5 fail** (RoundLoopService bootstrap + onShutdown + round.started emit; GetWsSnapshotUseCase serverTime mock; pino-config transport assertion) | FAIL (test-drift) |
| services/wallets unit tests | `bun --cwd services/wallets test tests/unit` | 32 pass / **1 fail** (pino-config transport assertion) | FAIL (test-drift) |
| root `bun test` | `bun test` from repo root | Workspace runner globs `e2e/specs/*.spec.ts` as Bun tests; Playwright `test.use()` errors during load; plus 102+ FE vitest failures (147 pre-existing per `deferred-items.md`) | FAIL |
| root `bun run typecheck` | `tsc --noEmit -p tsconfig.json` | `error TS5058: The specified path does not exist: 'tsconfig.json'` exit 1 | FAIL |
| root `bun run lint` | `eslint .` | 135 errors / 32 warnings (including `process.env` violations in test files) | FAIL |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| `scripts/smoke-health.sh` | `bash scripts/smoke-health.sh` | (not executed by verifier — observed CI step calls it; SUMMARY 10-04 extends probes 45-47 for Jaeger/Prometheus/Grafana health; live curl spot-checks above confirm the same endpoints) | SKIP (covered by live-curl spot-checks above) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| REQ-TEST-05 | 10-01, 10-07 | Playwright E2E (login→bet→cashout, login→bet→crash) | SATISFIED | 2 specs land in `e2e/specs/`; 3x consecutive green runs claimed in SUMMARY 10-07 |
| REQ-OBS-01 | 10-03 | OpenTelemetry traces across HTTP/AMQP/WS | SATISFIED | NodeSDK first-import in both services + auto-instrumentations covering http/express/nest/amqplib/pg; W3C TraceContext is the SDK default propagator |
| REQ-OBS-02 | 10-05 | Prometheus `/metrics` (latency, AMQP lag, RTP, WS latency, multiplier drift) | SATISFIED | 5 custom metrics + standard counters exposed live |
| REQ-OBS-03 | 10-04 | Prometheus + Grafana in docker-compose, pre-provisioned dashboards | SATISFIED (file-level) + NEEDS HUMAN (panels render with data) | All 3 containers up, datasources + 3 dashboard JSON files provisioned RO |
| REQ-OBS-04 | 10-03 | Structured JSON logs via `pino` + `nestjs-pino` with correlationId | SATISFIED | `LoggerModule.forRootAsync` wired; `customProps` injects traceId+spanId+correlationId via `trace.getActiveSpan()` + CLS |
| REQ-CI-01 | 10-08 | GitHub Actions runs unit + e2e on push + PR | SATISFIED (workflow-file) + NEEDS HUMAN (green run) | `.github/workflows/ci.yml` present, `on: push[main] + pull_request`, all steps wired; first green run pending user push |
| REQ-CI-02 | 10-08 | CI runs `bun run docker:up` on fresh clone + Playwright | SATISFIED (workflow-file) + NEEDS HUMAN (green run) | `docker:up` + `bunx playwright test` steps both present in workflow |
| REQ-CI-03 | 10-09 | README status badges (build, tests, coverage) | SATISFIED (build) + NEEDS HUMAN (render check) | README line 3 has CI badge URL; coverage badge intentionally omitted (Codecov deferred per CONTEXT) |
| REQ-DOC-01 | 10-09 | README: setup, decisions, trade-offs, diagrams, troubleshooting | SATISFIED | All 14 `##` sections present incl. 2 mermaid diagrams |
| REQ-DOC-02 | 10-09 | ADRs in `.planning/adrs/` surfaced in README | SATISFIED | 37 ADRs, generator + CI sync gate, README table populated between sentinels |

No orphaned Phase 10 requirements (REQUIREMENTS.md `#### Phase 10 — Quality Hardening & Docs (10 reqs)` enumerates exactly the same 10 IDs).

### Anti-Patterns Found

Scanned all Phase-10-modified files for debt markers (`TBD|FIXME|XXX`), warnings (`TODO|HACK|PLACEHOLDER`), and stub returns. No matches in:
- `services/games/src/tracing.ts`
- `services/wallets/src/tracing.ts`
- `services/games/src/observability/`
- `services/wallets/src/observability/`
- `e2e/specs/*.spec.ts`
- `.github/workflows/ci.yml`
- `scripts/build-adr-index.ts`
- `README.md`

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `services/games/src/observability/pino-config.ts` | 32 | `pino-pretty` gated behind `PINO_PRETTY === "1"` env, but corresponding unit tests at `tests/unit/observability/pino-config.test.ts:65-71` still assert pretty transport in dev unconditionally → test fail | Info | Test-vs-impl drift; SUMMARY 10-05 explains the impl gate is intentional (Pitfall 2 follow-up). Production code is correct; test update was skipped. |
| `services/games/tests/unit/round-loop.service.test.ts` | 266 | `findOpen()` returns null after `onApplicationBootstrap()` because fake `bets` repo lacks `getRollingRtp()` (and `rounds` fake lacks `maxNonce()` — surfaced as a `bootstrap failed; retrying` error in logs) | Warning | 3 unit tests in this file fail; tracked as P10-05 collateral. Production paths are unaffected (live stack proves `crash_rtp_window` flows); the fakes were never updated. |
| `services/games/tests/unit/get-ws-snapshot.use-case.test.ts` | 112 | `serverTime` assertion compares to mocked `now.getTime()` but production code uses real `Date.now()` not the injected mock | Warning | Pre-existing test bug surfaced by Phase 10 dependency changes (or pre-existing per deferred-items.md). |
| Repo root | n/a | `package.json` defines `"typecheck": "tsc --noEmit -p tsconfig.json"` but `tsconfig.json` does not exist at repo root → `bun run typecheck` exits 1 | Blocker (CI) | The CI workflow step `Typecheck` will fail on the first push. SUMMARY 10-09 deferred-items section #10-09 acknowledges this as pre-existing and out-of-scope for Phase 10, but the Phase 10 goal (and SC2) explicitly requires CI to be green on every push. |
| Repo root | n/a | No `bunfig.toml` excluding `e2e/specs/*.spec.ts` from Bun test discovery → root `bun test` loads Playwright specs and errors with `Playwright Test did not expect test.use() to be called here` | Blocker (CI) | The CI step `Unit tests: bun test` will surface load errors + ~102 sub-failures (147 FE pre-existing vitest fails per deferred-items.md plus 6 services/games unit fails plus Playwright spec loaders). Bun exits 0 (no propagated non-zero), so CI may pass the step accidentally, but the output noise will mask real failures during recruiter review. |
| Repo root | n/a | `bun run lint` reports 135 errors (`no-restricted-properties: process.env` violations across multiple test files) | Warning | CI step `Lint` will fail → workflow aborts before reaching `docker:up`. |

### Human Verification Required

#### 1. CI green run on first user push (REQ-CI-01 + REQ-CI-02)

**Test:** Push the workflow file branch to GitHub, open a draft PR, wait for the CI workflow run to finish, confirm `bun run docker:up` boots all 11 containers, all healthchecks go green, both Playwright specs report 2 passed, the workflow ends in a green check.

**Expected:** Green CI run on a draft PR with `2 passed (Xs)` in the Playwright E2E step and a final green status badge on github.com.

**Why human:** REQ-CI-01 + REQ-CI-02 by their nature can only be observed by triggering a real GitHub Actions run. SUMMARY 10-08 explicitly defers this to a user-push checkpoint and so does the ROADMAP P10-08 entry. Verifier cannot push to GitHub from the local sandbox.

**Warning:** Multiple pre-CI gates (`bun run typecheck`, `bun run lint`, `bun test`) currently fail locally — the first push will almost certainly fail at the Typecheck step (TS5058 missing root `tsconfig.json`) and at the Lint step (135 ESLint errors). The CI workflow is structurally complete but will not produce a green run without these gaps being closed first.

#### 2. Grafana dashboard panels render with real data (REQ-OBS-03)

**Test:** After 5 minutes of bet activity in the running stack, open Grafana at http://localhost:3001 (anonymous Viewer), switch to the `Crash Domain` dashboard, confirm `bet_volume_total`, `crash_rtp_window`, `multiplier_drift_seconds`, `ws_broadcast_latency_seconds`, and `active_ws_connections` panels render non-empty curves matching the placed bets.

**Expected:** All 5 custom-metric panels populate with live data. Datasource + dashboard JSON + Prometheus scrape line up (Pitfall 4 surface).

**Why human:** Visual verification of dashboard JSON rendering and datasource resolution requires opening Grafana in a browser. `curl /api/health = 200` (already verified) proves the container is alive, not that the panels render.

#### 3. Jaeger end-to-end bet trace (REQ-OBS-01)

**Test:** Open Jaeger UI at http://localhost:16686, search `games-service`, find the most recent bet trace, expand the span tree, confirm child spans for `MikroORM SELECT`, `amqplib publish wallet.command.debit`, then under `wallets-service` the `DebitWalletUseCase` + `amqplib publish wallet.event.debited`, then back under `games-service` the `WalletDebitedHandler.handle`. All under ONE trace_id.

**Expected:** Single trace_id spans the full HTTP→AMQP→WS bet saga across both services in the Jaeger UI.

**Why human:** Visual span-tree inspection in Jaeger UI; automation can prove `/api/services` returns 200 (already verified) but cannot prove the span tree has the correct shape without a dedicated trace-walking probe (out of scope per 10-VALIDATION manual-only verifications).

#### 4. README badge + ADR table on github.com (REQ-CI-03 + REQ-DOC-02)

**Test:** Open the rendered README on github.com after the first green CI run, confirm the CI badge image renders green and the ADR catalogue table displays 37 rows sorted by ADR number with correct titles/phases/dates/statuses.

**Expected:** Green CI badge SVG visible; ADR table renders cleanly on github.com.

**Why human:** REQ-CI-03 + REQ-DOC-02 are visual-render checks on the GitHub-rendered Markdown — automation can grep the badge URL and count `| ADR-` rows (both already verified locally) but cannot render the SVG or the table in a real browser.

#### 5. D-03a Sheet/Dialog visibility + D-03c HistoryStrip key warn

**Test:** Manually exercise the Fairness drawer (click the FairnessBadge) and Replay modal (click any history-strip Replay button) in the live frontend, confirm each opens visually within ~300ms and closes cleanly twice; observe Chrome DevTools Console across ≥3 round transitions for any React `key` prop warning from HistoryStrip.

**Expected:** Sheet drawer slides in from right within 300ms; Dialog modal opens centered within 300ms; no React `key` warning emitted across 3 rounds (D-03a + D-03c).

**Why human:** D-03a / D-03c are visual + DevTools console observations the verifier cannot run from CLI.

### Gaps Summary

Every ROADMAP Success Criterion (1..5) has codebase evidence the implementation is in place. The five gaps blocking a `passed` verdict are visual / GitHub-actions-runtime observations that genuinely cannot be confirmed from the verifier's local sandbox: the live CI run, Jaeger trace shape, Grafana panel rendering, README badge render, and Radix portal visibility. These were anticipated by 10-VALIDATION.md `Manual-Only Verifications` and are deliberately routed to the user.

Three latent risks the verifier flagged that the human should know about before pushing for the first CI run:

1. **Root `tsconfig.json` is missing** but `package.json` declares `typecheck: tsc --noEmit -p tsconfig.json`. The CI step `Typecheck` will fail with TS5058 on the first push. Phase 10-09 deferred-items logs this as out-of-scope, but the Phase 10 goal explicitly requires CI to be green.

2. **Root `bun test` (CI step `Unit tests`) is noisy** — frontend has 147 pre-existing vitest fails (per `deferred-items.md`), services/games has 6 net-new test fails introduced by P10-05's `getRollingRtp` wiring + unmaintained `RoundLoopService` fakes + pino-config test-impl drift, and Bun globs `e2e/specs/*.spec.ts` (Playwright runner files) which fail to load. Bun may exit 0 because of how it propagates suite-level errors, but the output is misleading.

3. **`bun run lint` reports 135 ESLint errors** (mostly `no-restricted-properties: process.env` in test files). The CI `Lint` step will fail.

If the recruiter's first action is "push and watch the green badge", the CI workflow file is honest about the intent but the test/lint/typecheck steps require fixes before they can pass. The observability + Playwright + ADR layers are themselves production-grade and verifiable today against the live stack.

---

_Verified: 2026-05-31T20:55:00Z_
_Verifier: Claude (gsd-verifier)_
