---
phase: 10
slug: quality-hardening-docs
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-30
approved: 2026-05-30
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Extracted verbatim from 10-RESEARCH.md `## Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Bun test (unit + integration) + Playwright 1.60 (browser E2E) — both already in use |
| **Config file** | Bun: no config (default discovery); Playwright: NEW `e2e/playwright.config.ts` (Wave 0 — plan 10-01) |
| **Quick run command** | `bun test` (per-workspace) for the changed metric / pino / snapshot tests |
| **Full suite command** | `bun test && bunx playwright test --config=e2e/playwright.config.ts` |
| **Estimated runtime** | Unit ~30s per workspace; Integration ~60-90s per service (INTEGRATION=1 + docker:up); Playwright ~2-4 min for the 2 specs against live stack |

---

## Sampling Rate

- **After every task commit:** Run `bun test` for the changed workspace only (services/games OR services/wallets OR frontend OR packages/contracts)
- **After every plan wave:** Root `bun test` + `bunx playwright test --config=e2e/playwright.config.ts`
- **Before `/gsd:verify-work`:** Full suite green + `bun run smoke:health` (47 probes per 10-04) + manual: open Jaeger UI confirm a bet trace + open Grafana confirm custom dashboard panels populate
- **Max feedback latency:** ~30s for unit (per-workspace `bun test`); ~5 min for full suite including Playwright

---

## Per-Requirement Verification Map

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| REQ-TEST-05 (a) | login → BETTING → bet → RUNNING → cashout → balance updated | e2e (Playwright) | `bunx playwright test e2e/specs/bet-cashout.spec.ts` | ❌ Wave 0 (plan 10-01 scaffold, plan 10-07 real spec) | ⬜ pending |
| REQ-TEST-05 (b) | login → bet → wait crash → bet lost | e2e (Playwright) | `bunx playwright test e2e/specs/bet-crash.spec.ts` | ❌ Wave 0 (plan 10-01 scaffold, plan 10-07 real spec) | ⬜ pending |
| REQ-OBS-01 | OTel SDK init order + traceparent propagation HTTP→AMQP | integration (smoke) | `INTEGRATION=1 bun test services/games/tests/integration/otel-propagation.test.ts` + manual: hit `GET /games/rounds/current`, verify span tree in Jaeger UI | ❌ Wave 0 (plan 10-03 creates) | ⬜ pending |
| REQ-OBS-02 | `/metrics` endpoint returns Prometheus exposition format | integration | `INTEGRATION=1 bun test services/games/tests/integration/metrics-endpoint.test.ts` — assert 200 + content-type + presence of `crash_bet_volume_total`, `crash_rtp_window`, `crash_multiplier_drift_seconds`, `crash_ws_broadcast_latency_seconds`, `crash_active_ws_connections` | ❌ Wave 0 (plan 10-05 creates) | ⬜ pending |
| REQ-OBS-02 (custom metrics emit) | `bet_volume_total` increments on cashout / lost / refunded; `active_ws_connections` inc/dec on connect/disconnect | unit | `bun test services/games/tests/unit/observability/metrics/*.test.ts` | ❌ Wave 0 (plan 10-05 creates) | ⬜ pending |
| REQ-OBS-03 | Jaeger + Prometheus + Grafana containers healthy with pre-provisioned dashboards | smoke probe | extend `scripts/smoke-health.sh` (probes 45-47): `curl -sf http://localhost:9090/-/healthy && curl -sf http://localhost:3001/api/health && curl -sf http://localhost:16686/` | ❌ Wave 0 (plan 10-04 extends existing smoke script) | ⬜ pending |
| REQ-OBS-04 | Log lines contain `traceId` + `correlationId` | unit | `bun test services/games/tests/unit/observability/pino-config.test.ts` — mock OTel + CLS, capture log output, assert fields | ❌ Wave 0 (plan 10-03 creates) | ⬜ pending |
| REQ-CI-01 | CI runs on push to main + pull_request with concurrency cancel | manual (observed by CI itself) | first push triggers actions; verify workflow run in gh UI | ❌ N/A (workflow IS the test — plan 10-08) | ⬜ pending |
| REQ-CI-02 | CI runs `bun run docker:up` on fresh clone + Playwright | manual (observed by CI itself) | green CI run on draft PR per plan 10-08 Task 2 checkpoint | ❌ N/A (workflow IS the test — plan 10-08) | ⬜ pending |
| REQ-CI-03 | README CI status badge renders | manual / visual | render README on github.com after merge, confirm badge image loads green | ❌ N/A (plan 10-09 adds badge URL; visual only) | ⬜ pending |
| REQ-DOC-01 | README has Quick Start / Architecture / Saga / Provably-Fair / ADR / Scripts / Env / Troubleshooting / CI badge sections | unit + visual | grep gate from plan 10-09 Task 3 verify block + visual render on github.com | ❌ Wave 0 (plan 10-09 creates) | ⬜ pending |
| REQ-DOC-02 | ADR catalogue table auto-generated and surfaced in README | unit | `bun test scripts/build-adr-index.test.ts` — fixture ADR dir, assert markdown table; CI `bun run docs:adr-index:check` fails on drift | ❌ Wave 0 (plan 10-09 creates) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Polish defects (D-03) coverage (not REQ-IDs but tracked here):**

| Defect | Behavior | Test Type | Command | Status |
|--------|----------|-----------|---------|--------|
| D-03a | Sheet (Fairness drawer) + Dialog (Replay modal) visually open within ~300ms of click | manual + visual + screenshot evidence | plan 10-06 Task 1 checked-in screenshots + dev-server live verify | ⬜ pending |
| D-03b | `round:snapshot=null` no-ops without zod warn | unit | `bun --cwd packages/contracts test tests/ws/round-snapshot-nullable.test.ts` + extended FE dispatcher test | ⬜ pending |
| D-03c | HistoryStrip renders without React key warn across ≥3 rounds | manual (live console observation) | plan 10-06 Task 3 checkpoint — verify in DevTools console; fix only if warn appears | ⬜ pending |

---

## Wave 0 Requirements

Files that MUST exist (test scaffolds + framework wiring) BEFORE the implementation tasks that exercise them. Each item maps to a Wave-0 plan task:

- [ ] `e2e/playwright.config.ts` — Playwright config with webServer + storageState (plan 10-01 Task 1)
- [ ] `e2e/fixtures/auth.fixture.ts` — globalSetup OIDC login → storageState (plan 10-01 Task 1)
- [ ] `e2e/specs/bet-cashout.spec.ts` — REQ-TEST-05 (a) scaffold w/ test.skip (plan 10-01 Task 1, replaced by plan 10-07)
- [ ] `e2e/specs/bet-crash.spec.ts` — REQ-TEST-05 (b) scaffold w/ test.skip (plan 10-01 Task 1, replaced by plan 10-07)
- [ ] `services/games/tests/integration/metrics-endpoint.test.ts` — REQ-OBS-02 contract (plan 10-05 Task 1)
- [ ] `services/games/tests/integration/otel-propagation.test.ts` — REQ-OBS-01 contract (plan 10-03)
- [ ] `services/games/tests/unit/observability/metrics/bet-volume.metric.test.ts` — custom metric increment (plan 10-05 Task 2)
- [ ] `services/games/tests/unit/observability/metrics/active-ws-connections.metric.test.ts` — gauge inc/dec (plan 10-05 Task 2)
- [ ] `services/games/tests/unit/observability/metrics/crash-rtp-window.metric.test.ts` — rolling RTP (plan 10-05 Task 2)
- [ ] `services/games/tests/unit/observability/pino-config.test.ts` — customProps traceId+correlationId enrichment (plan 10-03)
- [ ] `services/wallets/tests/integration/metrics-endpoint.test.ts` — mirror games-side (plan 10-05 Task 1)
- [ ] `packages/contracts/tests/ws/round-snapshot-nullable.test.ts` — D-03b schema regression (plan 10-06 Task 2)
- [ ] `scripts/build-adr-index.test.ts` — fixture ADR dir, assert markdown table (plan 10-09 Task 1)
- [ ] Extend `scripts/smoke-health.sh` probes 45-47 with Jaeger/Prometheus/Grafana health (plan 10-04)
- [ ] Framework install: `cd frontend && bun add -d @playwright/test@^1.60.0 && bunx playwright install --with-deps chromium` (plan 10-01 / 10-02 — Playwright not yet installed)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Playwright live-stack end-to-end smoke | REQ-TEST-05 + REQ-CI-02 | Playwright runs ARE the verification — the spec passing IS the proof; no automated "test of the test" possible. The CI workflow run on a draft PR is the manual verification surface for REQ-CI-02 zero-step bootstrap. | Push branch, open draft PR, watch CI workflow run, confirm "2 passed" in Playwright step + green workflow status. Plan 10-08 Task 2 is the explicit blocking-human checkpoint. |
| Jaeger UI shows end-to-end bet trace | REQ-OBS-01 + REQ-OBS-03 | Visual span-tree inspection in Jaeger UI proves trace propagation across HTTP→AMQP→WS boundaries; automation can assert traces exist but cannot assert "the trace tree is correct shape" without writing a trace-walking probe (out of scope for this submission). | Open http://localhost:16686, search for service `games-service`, find the most recent bet trace, expand the span tree, confirm child spans for `MikroORM SELECT`, `amqplib publish wallet.command.debit`, then under wallets-service `DebitWalletUseCase` + `amqplib publish wallet.event.debited`, then back under games-service `WalletDebitedHandler.handle`. All under ONE trace_id. |
| Grafana custom dashboard panels populate with real data | REQ-OBS-02 + REQ-OBS-03 | Pre-provisioned dashboards must show non-empty panels after a few minutes of bet activity; visual confirmation that datasource UID + dashboard JSON ref + Prometheus scrape all line up (Pitfall 4 surface). | Open http://localhost:3001 anonymous Viewer, navigate to "Crash Domain" dashboard, place ≥3 bets via the FE, wait ~30s (Prometheus scrape interval), confirm `bet_volume_total` panel shows rising counter + `crash_rtp_window` panel shows non-zero gauge + `multiplier_drift_seconds` histogram populated. |
| D-03a Sheet + Dialog visibility | D-03a | Visual confirmation that Radix portals slide in / open within ~300ms of click — no automated test for "did the content visually appear" beyond screenshot diff (which is brittle for animations). | Plan 10-06 Task 1: click Fairness badge → drawer slides in from right within ~300ms; click any history Replay → modal opens centered within ~300ms; close + reopen each twice; commit screenshots to `.planning/phases/10-quality-hardening-docs/d03a-fix-verified/`. |
| D-03c HistoryStrip React key warn | D-03c | DevTools console observation across multiple live rounds is the verification surface (the warn either appears or it doesn't); automation cannot cleanly assert "no React dev-time warn was emitted to console". | Plan 10-06 Task 3 blocking-human checkpoint: open Chrome DevTools Console, watch ≥3 rounds complete, search for "Each child in a list should have a unique 'key' prop" or "Encountered two children with the same key". |
| README CI badge renders green | REQ-CI-03 | Visual render on github.com — automation can grep that the badge URL exists in README but cannot prove the rendered SVG is green without rendering it in a browser. | Plan 10-09 closeout: after final CI run on the merge commit, open README on github.com, confirm the `![CI](.../ci.yml/badge.svg)` image renders + shows green. |
| README ADR table populated visually | REQ-DOC-02 | Visual confirmation that the sentinel-bounded section was filled by `bun run docs:adr-index` and renders as a clean markdown table on github.com. | Plan 10-09 Task 4: run `bun run docs:adr-index`, then render README locally + on github.com, confirm table has 37 rows sorted by ADR number with correct titles / phases / dates / statuses. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (REQ-CI-01..03 + REQ-DOC-01 explicitly classified as manual-only above per their inherent verification surface)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (per-task `<verify><automated>` blocks in every plan 10-01 through 10-09 inspected)
- [x] Wave 0 covers all MISSING references (15 Wave 0 items above map to plan 10-01, 10-02, 10-03, 10-05, 10-06, 10-09 task scaffolds)
- [x] No watch-mode flags (no `--watch` in any verify command across the 9 plans)
- [x] Feedback latency < 5 min for full suite; < 30s for per-workspace `bun test`
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-30
