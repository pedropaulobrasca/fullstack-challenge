# Phase 10: Quality Hardening & Docs - Context

**Gathered:** 2026-05-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Final integration phase. Every claim in the submission becomes provable by automation: Playwright covers the player flow end-to-end against the live docker stack; OpenTelemetry traces ride every saga across HTTP/AMQP/WS; Prometheus + Grafana surface latency / AMQP lag / WS connections + custom domain metrics (bet volume, RTP, multiplier drift, WS broadcast latency); pino emits structured JSON with correlationId+traceId enrichment; GitHub Actions runs `bun run docker:up` on a fresh clone for every push/PR (proving the zero-step bootstrap claim); README + ADR catalogue let a reviewer reconstruct every decision without asking. Delivers REQ-TEST-05 + REQ-OBS-01..04 + REQ-CI-01..03 + REQ-DOC-01..02.

Also closes 3 polish defects surfaced by Phase 8 live smoke: Radix Sheet (Fairness drawer) + Radix Dialog (Replay modal) not visually opening on click (portal/z-stack), WS `round:snapshot` occasionally null at connect (gateway sends null when between rounds), HistoryStrip React `key` prop warning.

</domain>

<decisions>
## Implementation Decisions

### OpenTelemetry trace backend
- **D-01:** OTLP exporter → **Jaeger all-in-one** container in docker-compose. Industry standard, recruiter familiarity, single container, clean UI showing the bet→saga→cashout span tree end-to-end. Tempo+Grafana alternative explicitly rejected (2 extra containers for marginal UX gain when Grafana already exists for metrics).

### Playwright E2E scope
- **D-02:** Exactly the **2 REQ-TEST-05 mandatory specs**: (a) login → wait for BETTING → place bet → wait for RUNNING → cashout → verify balance updated; (b) login → bet → crash → verify bet lost. CI time-optimized. Additional Phase 8/9 surfaces (fairness drawer, replay modal, auto-bet, leaderboard live) are tested by their existing vitest+integration suites; expanding Playwright scope is stretch.

### Polish defects from Phase 8 live smoke
- **D-03:** **Fix all three** as quality tasks within this phase. Senior-level submission cannot ship visible defects; Playwright also won't deliver SC1 if Radix portals don't open. The three are:
  - **D-03a Radix portal visibility**: Fairness drawer (Sheet) + Replay modal (Dialog) click handler sets state but content never appears. Root-cause (portal mount target vs z-stack vs Radix `data-state` collision) and fix.
  - **D-03b WS `round:snapshot=null`**: Gateway's `GetWsSnapshotUseCase` returns null when no round is between states at connect time → FE zod `safeParse` rejects with "Expected object, received null". Either guard the schema to accept null + treat as no-op, OR defer the emit in the gateway until a round exists. Pick the cleaner path during planning.
  - **D-03c HistoryStrip React `key` prop warn**: Map missing/duplicate key — single-line fix.

### Logger
- **D-04:** `pino` + `nestjs-pino` per REQ-OBS-04. JSON structured, `correlationId` (from existing saga envelope) + `traceId` (from OTel current context) enrichment. Replace existing NestJS Logger calls service-side. Match existing log shape conventions.

### OpenTelemetry SDK
- **D-05:** `@opentelemetry/sdk-node` + `nestjs-otel` bridge + auto-instrumentations (http, express/nest, amqplib, ioredis if present, pg). W3C TraceContext propagation across HTTP+AMQP+WS boundaries. Custom spans where saga handlers cross queue boundaries to keep correlation visible.

### Metrics
- **D-06:** Prometheus via `nestjs-prometheus` (or equivalent) at `/metrics`; built-in counters/histograms via `prom-client`. Custom metrics: `bet_volume_total` (counter, labels: status), `crash_rtp_window` (gauge), `multiplier_drift_seconds` (histogram, server-tick vs wall-clock diff), `ws_broadcast_latency_seconds` (histogram, emit-to-clientAck or proxy via tick-to-emit time), `active_ws_connections` (gauge). Pre-provisioned Grafana dashboards (one per service + one custom) loaded from `docker/grafana/provisioning/`.

### CI strategy
- **D-07:** GitHub Actions per REQ-CI-02 — `bun run docker:up --wait` on the runner; wait for healthchecks; run unit + integration + Playwright against the live stack; teardown. Single workflow file `.github/workflows/ci.yml`. Concurrency cancellation per branch. README badges link build/tests/coverage (coverage from `bun test --coverage`). Free runner timeout (6h) is plenty.

### README + ADR catalogue
- **D-08:** README sections: Quick Start (one-command `bun run docker:up`) → Architecture (mermaid diagram of services + flow) → Saga Flow (mermaid sequence diagram) → Provably-Fair (link to existing Phase 8 walkthrough already in README) → ADR Catalogue (table linking every ADR-001..034 + future ADR-035+ from this phase) → Scripts → Env Vars → Troubleshooting → CI badges. ADR catalogue lives in the README (D-08 = ADR-029 anticipated label reconciles to **next-free 035+**).

### Claude's discretion
- Exact Jaeger compose image tag, Prometheus scrape interval, Grafana provisioning structure, dashboard JSON shape, Playwright project layout (single workspace vs `frontend/e2e` dir), Mermaid diagram exact wording, Troubleshooting items to surface, CI matrix (single Ubuntu job vs OS matrix — single is plenty for this submission).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope + requirements
- `.planning/ROADMAP.md` §"Phase 10: Quality Hardening & Docs" — goal + 5 success criteria + anticipated ADRs (numbering reconciled to ADR-035+ during planning — 001..034 taken)
- `.planning/REQUIREMENTS.md` — REQ-TEST-05, REQ-OBS-01..04, REQ-CI-01..03, REQ-DOC-01..02 + "Open Configuration Values"

### OTel + metrics + logs (NestJS bridges)
- `services/games/src/main.ts` + `services/wallets/src/main.ts` — bootstrap hook for SDK init (MUST initialize OTel SDK BEFORE NestJS bootstrap so http auto-instrumentation captures the listen call)
- `packages/messaging-spine/` — AMQP envelope already carries `correlationId` + `causationId` (Phase 2). OTel `traceId` propagation rides alongside via W3C TraceContext headers in message properties.
- `services/games/src/presentation/gateways/game-ws.gateway.ts` — WS handshake propagation (custom span around `handleConnection` linking to upstream HTTP trace)

### Playwright E2E
- `.planning/research/STACK.md` — Playwright 1.49+ locked
- `frontend/` — TanStack Start app the E2E specs target
- Keycloak `crash-game` realm + `player/player123` demo user (Phase 1) — the auth flow Playwright authenticates against
- `docker/kong/kong.yml` — Kong routes the FE consumes (already CORS-enabled per Phase 7 + OPTIONS-enabled per Phase 8)
- Existing smoke probes at `scripts/smoke-health.sh` — Playwright is the bigger-scope replacement for the bet-loop probes (39-44)

### CI
- `package.json` root scripts (`bun run docker:up` / `docker:down` / `test` / `lint` / `typecheck`)
- `.github/workflows/` (currently empty) — new `ci.yml`

### Polish defect roots
- `.planning/phases/08-provably-fair-history-replay/VERIFICATION.md` §Live Browser Smoke — the 3 polish defects (#2 Sheet drawer, #3 Dialog modal, #4 WS round:snapshot null) + HistoryStrip key warn
- `frontend/src/components/verification-drawer.tsx` (Sheet) + `frontend/src/components/replay-modal.tsx` (Dialog) + `frontend/src/components/history-strip.tsx`
- `services/games/src/presentation/gateways/game-ws.gateway.ts` + `services/games/src/application/use-cases/get-ws-snapshot.use-case.ts` (WS round:snapshot null path)
- `packages/contracts/src/ws/` — round:snapshot zod schema (relax to accept null, OR keep strict and fix server)

### Standards
- `CLAUDE.md` — atomic commits, no AI attribution, no hardcoded business constants, Money VO, structured logs, OTel propagation
- `.planning/adrs/` — existing ADR-001..034 catalogue

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Messaging spine envelope** already carries `correlationId` + `causationId` (Phase 2 outbox + inbox) — OTel `traceId` slots in via W3C TraceContext message properties without disrupting the existing payload shape.
- **Smoke probes** at `scripts/smoke-health.sh` (44 probes through Phase 6) — Playwright supersedes the bet-loop probes (33-44) but the infra probes (1-32) stay valuable for CI fast-fail.
- **Phase 8 README "Provably Fair: Verify Outside the App"** section — already recruiter-runnable; Phase 10 README adds Quick Start + Architecture + ADR catalogue sections AROUND it, doesn't replace it.
- **getConfig() pattern** (Phase 7) + `env.ts` defaults (services) — OTel + metrics + logger env vars (OTEL_EXPORTER_OTLP_ENDPOINT, JAEGER_HOST, etc) plug into the established typed config.
- **Existing 23 ADRs** — Phase 10 README's ADR Catalogue table renders the existing list + any Phase 10 additions (ADR-035..037 anticipated: OTel SDK choice, ADR catalogue location, CI strategy).

### Established Patterns
- One service per docker compose container — Jaeger + Prometheus + Grafana follow the same single-purpose container pattern.
- Pre-provisioned Keycloak realm import (Phase 1) — Grafana dashboards follow the same "imported on first up" pattern via `docker/grafana/provisioning/`.
- bun for test/lint/typecheck — CI runs bun, NOT npm/pnpm.
- No emojis, no AI attribution in commits — same applies to README + ADRs.

### Integration Points
- OTel SDK init in `main.ts` MUST be the very first import before NestJS bootstrap (auto-instrumentation hook order).
- Pino replaces NestJS default Logger via `app.useLogger(app.get(Logger))` after `LoggerModule.forRoot()`.
- AMQP propagation requires the publisher to inject TraceContext into message properties and the consumer to extract on receive — `@golevelup/nestjs-rabbitmq` consumer + the amqplib publisher both need a small middleware wrap.
- WS propagation injects the upstream trace context into `socket.handshake.auth` (already a known surface from Phase 6 JWT auth) so Playwright assertions can correlate the browser HTTP login span with the WS handshake span.
- Playwright runs against `docker:up` localhost — no FE deploy needed. Spec under `frontend/e2e/` or root `e2e/`; planner picks.
- README's ADR catalogue table is generated, not hand-maintained — small script (`scripts/build-adr-index.ts`) reads `.planning/adrs/ADR-*.md` frontmatter and outputs the markdown table, run pre-commit or in CI.

</code_context>

<specifics>
## Specific Ideas

- Jaeger UI url surfaced in README Quick Start ("trace any bet end-to-end at http://localhost:16686").
- Grafana default creds `admin/admin` documented in README Troubleshooting (or pre-provisioned anonymous read-only org for recruiter convenience).
- Playwright artifacts (videos+screenshots on failure) uploaded as GitHub Actions artifacts so a failed CI run is debuggable without re-running.
- README CI badges: `![CI](https://github.com/.../actions/workflows/ci.yml/badge.svg)` + `![Coverage](https://img.shields.io/codecov/c/github/...)` (optional; coverage badge depends on whether codecov is wired — planner decides).
- ADR catalogue table columns: # / Date / Title / Phase / Status — sorted by number.
- Custom metric `crash_rtp_window` (gauge) is the differential observability claim — RTP drift over a rolling N-round window proves the game is running honestly to the recruiter.

</specifics>

<deferred>
## Deferred Ideas

- Codecov integration (depends on free-tier signup); README can ship a "Coverage badge pending Codecov enroll" or a static % link to a CI step artifact.
- Splunk/Datadog APM (commercial APM) — explicitly rejected per ADR-035 (OSS Jaeger).
- Synthetic monitoring (uptime probes) — out of scope for this submission.
- Distributed tracing of the Postgres queries via `@opentelemetry/instrumentation-pg` is part of the auto-instrumentation set — not separately documented.
- Per-route Playwright sharding — single shard runs fast enough on free runner.
- Lighthouse / web-vitals CI — out of scope.
- Alerting on Prometheus thresholds (Alertmanager) — out of scope.

</deferred>

---

*Phase: 10-Quality Hardening & Docs (FINAL)*
*Context gathered: 2026-05-30*
