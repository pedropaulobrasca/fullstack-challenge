---
phase: 10-quality-hardening-docs
plan: 03
subsystem: observability-foundation (OTel + pino + correlationId enrichment)
tags:
  - opentelemetry
  - nestjs-pino
  - tracing-init-order
  - pino-correlation
  - nestjs-otel
dependency-graph:
  requires:
    - 10-01 (typed OTEL_EXPORTER_OTLP_ENDPOINT + OTEL_SERVICE_NAME + LOG_LEVEL in both services' zod schemas)
    - 10-02 (OTel SDK + nestjs-pino + nestjs-otel + pino-pretty + pino-http packages installed in both services)
  provides:
    - services/{games,wallets}/src/tracing.ts — NodeSDK + OTLP HTTP exporter + auto-instrumentations + SIGTERM shutdown
    - services/{games,wallets}/src/main.ts — literal-first `import "./tracing"` + bufferLogs:true + app.useLogger(Logger)
    - services/{games,wallets}/src/observability/observability.module.ts — LoggerModule.forRootAsync + OpenTelemetryModule composed
    - services/{games,wallets}/src/observability/pino-config.ts — customProps {traceId, spanId, correlationId} + redact {authorization, cookie} + transport gated on NODE_ENV
    - 5 new unit tests per service covering init-order + pino-config
  affects:
    - 10-04 (Jaeger collector will receive OTLP traffic once compose adds the service)
    - 10-05 (custom Prometheus metrics can reuse trace.getActiveSpan() for exemplars)
    - 10-08 (CI will run the same unit suite with the init-order gate enforced)
tech-stack:
  added:
    - none (all deps installed in 10-02)
  patterns:
    - "tracing.ts as the LITERAL FIRST IMPORT of main.ts — OTel auto-instrumentations patch require cache before any other module loads (Footgun #1)"
    - "nestjs-pino LoggerModule.forRootAsync(inject:[ClsService]) + buildPinoOptions factory — composes traceId from OTel + correlationId from messaging-spine CLS in a single customProps hook"
    - "ObservabilityModule scopes ALL OTel/pino imports to services/*/src/observability/ — domain layer stays free of infrastructure imports (CLAUDE.md domain purity)"
    - "exactOptionalPropertyTypes-safe transport: conditional assignment instead of `transport: undefined` to satisfy ts strict mode"
key-files:
  created:
    - services/games/src/tracing.ts
    - services/games/src/observability/observability.module.ts
    - services/games/src/observability/pino-config.ts
    - services/games/tests/unit/observability/tracing-init-order.test.ts
    - services/games/tests/unit/observability/pino-config.test.ts
    - services/wallets/src/tracing.ts
    - services/wallets/src/observability/observability.module.ts
    - services/wallets/src/observability/pino-config.ts
    - services/wallets/tests/unit/observability/tracing-init-order.test.ts
    - services/wallets/tests/unit/observability/pino-config.test.ts
  modified:
    - services/games/src/main.ts (literal first line is now `import "./tracing";` + bufferLogs:true + app.useLogger(Logger))
    - services/games/src/app.module.ts (ObservabilityModule added to imports)
    - services/wallets/src/main.ts (literal first line is now `import "./tracing";` + bufferLogs:true + app.useLogger(Logger))
    - services/wallets/src/app.module.ts (ObservabilityModule added to imports)
decisions:
  - "tracing.ts reads from the typed `env` re-export (config/defaults.ts) instead of `process.env` — single-source-of-truth for OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_SERVICE_NAME, per CLAUDE.md 'no hardcoded business constants'."
  - "pino transport is conditionally assigned (`if (!isProd) base.transport = ...`) instead of `transport: process.env.NODE_ENV !== 'production' ? ... : undefined` because tsconfig.exactOptionalPropertyTypes=true rejects `undefined` assignment to an optional property. Behavior identical."
  - "ClsService injection at LoggerModule.forRootAsync factory time works because MessagingSpineModule (global) imports MessagingClsModule.forRoot() which mounts ClsModule.forRoot({global:true}); ObservabilityModule does NOT need to import MessagingClsModule itself."
  - "Container rebuilds (`docker compose build games wallets`) deferred to Wave 2 — Jaeger lands in plan 10-04 so traces have a destination; running the new image now would just retry-and-fail against the absent collector."
metrics:
  duration: "~6 min (analyze + 2 TDD RED+GREEN cycles + 4 atomic commits + state updates)"
  completed: "2026-05-31"
requirements:
  - REQ-OBS-01 (in progress — logs carry traceId + correlationId; metrics landing in 10-05)
  - REQ-OBS-04 (in progress — OTel SDK wired end to end; Jaeger UI verification gated on 10-04 collector)
---

# Phase 10 Plan 03: OTel + pino + correlationId Foundation Summary

One-liner: OpenTelemetry NodeSDK now boots as the LITERAL first import of both services' main.ts (Footgun #1 gate enforced by source-grep test), pino structured JSON logging is wired through nestjs-pino with a customProps hook that enriches every log line with `{traceId, spanId, correlationId}` from `trace.getActiveSpan()` + the messaging-spine `ClsService`, and pino-pretty is gated to non-production (Pitfall 2). Wave 1 observability foundation is complete; Wave 2 (Jaeger + Prometheus + custom metrics) can now consume it.

## What was built

### Task 1 — tracing.ts as literal first import + main.ts re-ordered (commits `fd58813` RED + `f3fb0b3` GREEN)

**services/games/src/tracing.ts + services/wallets/src/tracing.ts** — identical structure, differing only in their `env.OTEL_SERVICE_NAME` default (`games-service` vs `wallets-service`):

- `new NodeSDK({ resource, traceExporter, instrumentations })`
- `resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME, [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? "0.0.0" })`
- `traceExporter: new OTLPTraceExporter({ url: env.OTEL_EXPORTER_OTLP_ENDPOINT })` (defaults to `http://jaeger:4318/v1/traces` per 10-01 typed env)
- `instrumentations: [getNodeAutoInstrumentations({ "@opentelemetry/instrumentation-fs": { enabled: false } })]` (fs noise disabled per RESEARCH Pattern 1)
- `sdk.start()` called SYNCHRONOUSLY at module top level — NO top-level await (Pitfall 1 — would race with NestJS module initialization)
- `process.on("SIGTERM", () => void sdk.shutdown().finally(() => process.exit(0)))` — ensures the last batch of spans flushes on container stop

**services/games/src/main.ts + services/wallets/src/main.ts** — both now start LITERALLY with:

```ts
import "./tracing";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
// ... existing imports
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // ... existing post-bootstrap wiring
}
```

The Footgun #1 source-grep gate:

```
$ head -1 services/games/src/main.ts
import "./tracing";
$ head -1 services/wallets/src/main.ts
import "./tracing";
```

`reflect-metadata` previously held position 1; it now sits at position 2. Auto-instrumentations patch the require cache (http, dns, amqplib, mikro-orm/pg, socket.io, etc.) BEFORE any NestJS module loads — exactly the contract OTel auto-instr requires.

`bufferLogs: true` ensures NestJS bootstrap logs route through nestjs-pino once `app.useLogger(app.get(Logger))` resolves, instead of going to the default console logger (Pitfall 2 — `nestjs-pino` README "Bootstrap logging").

**Test gate at `services/{games,wallets}/tests/unit/observability/tracing-init-order.test.ts`**:
1. Reads `services/games/src/main.ts` via `node:fs/promises.readFile`, splits on `\n`, asserts line 0 matches `/^import\s+"\.\/tracing"/`.
2. Same for `services/wallets/src/main.ts`.
3. Imports `../../../src/tracing` and asserts the exported `sdk` is defined (proof that the module loaded without throwing).

Both test files run from each service's vantage and pass green.

### Task 2 — ObservabilityModule + pino-config with traceId/correlationId enrichment (commits `facd52b` RED + `bff3a3b` GREEN)

**services/{games,wallets}/src/observability/pino-config.ts** — `buildPinoOptions(cls: ClsService)` returns a pino-http `Options` shape:

- `level: env.LOG_LEVEL` (default `info`, configurable via env)
- `formatters: { level: (label) => ({ level: label }) }` (string label instead of numeric — Loki/Grafana friendlier)
- `customProps: () => ({ traceId, spanId, correlationId })`:
  - `traceId` + `spanId` from `trace.getActiveSpan()?.spanContext()` (OTel current span) — `null` when no active span
  - `correlationId` from `cls.get<string>("correlationId")` — the saga correlationId set by `MessagingClsModule` middleware on inbound HTTP and AMQP messages — `null` when CLS context has none
- `redact: { paths: ["req.headers.authorization", "req.headers.cookie"], remove: true }` — Security V5 mitigation for T-10-05 (Information Disclosure)
- Conditional `transport`: only assigned when `process.env.NODE_ENV !== "production"`, and set to `{ target: "pino-pretty", options: { colorize: true } }`. In production the property is absent (NOT `undefined`) — Pitfall 2 mitigation for T-10-08 (pino-pretty in production crashes the container) and `exactOptionalPropertyTypes`-compliant.

The factory type is `Extract<NonNullable<Params["pinoHttp"]>, { customProps?: unknown }>` — pulled from `nestjs-pino`'s `Params` so we don't depend on `pino-http` as a direct dep (it's transitive).

**services/{games,wallets}/src/observability/observability.module.ts**:

```ts
@Module({
  imports: [
    OpenTelemetryModule.forRoot({
      metrics: { hostMetrics: false, apiMetrics: { enable: true } },
    }),
    LoggerModule.forRootAsync({
      inject: [ClsService],
      useFactory: (cls: ClsService) => ({ pinoHttp: buildPinoOptions(cls) }),
    }),
  ],
  exports: [LoggerModule, OpenTelemetryModule],
})
export class ObservabilityModule {}
```

- `OpenTelemetryModule.forRoot` is from `nestjs-otel` — exposes decorator surface (`@Span`, `@MetricCounter`, etc.) for downstream plans. Host metrics disabled (Wave 2 will use Prometheus host_exporter); apiMetrics enabled to surface HTTP route timings.
- `LoggerModule.forRootAsync` injects `ClsService` (available globally because `MessagingSpineModule` is `global: true` and imports `MessagingClsModule.forRoot()` which mounts `ClsModule.forRoot({ global: true })` — RESEARCH Assumption A8 verified).

**services/{games,wallets}/src/app.module.ts** — `ObservabilityModule` appended to the `imports` array. No removals; existing module order preserved.

**Test gate at `services/{games,wallets}/tests/unit/observability/pino-config.test.ts`** — 5 tests:
1. customProps returns `{traceId: "abc123", spanId: "def456", correlationId: "corr-xyz"}` when both OTel span and CLS correlationId are present (monkey-patched `trace.getActiveSpan` + stub `ClsService`)
2. customProps returns `{traceId: null, spanId: null, correlationId: null}` when both are absent — does NOT throw
3. transport is `{target: "pino-pretty", options: {colorize: true}}` when `NODE_ENV !== "production"`
4. transport is absent (undefined) when `NODE_ENV === "production"` (Pitfall 2)
5. redact paths include `req.headers.authorization` AND `req.headers.cookie` (T-10-05)

All 5 tests pass in BOTH services.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `pino-http` not in direct deps → use `Params["pinoHttp"]` from nestjs-pino**
- **Found during:** Task 2 tsc check
- **Issue:** `import type { Options } from "pino-http"` failed because pino-http is a transitive dep, not a direct dep of either service's package.json. Adding it would have required a separate `bun add` (Rule 3 EXCLUDED — package installs need human verification).
- **Fix:** Pulled the same type through `nestjs-pino`'s public `Params` type: `type PinoHttpOptions = Extract<NonNullable<Params["pinoHttp"]>, { customProps?: unknown }>`. No package install needed; semantic identity preserved because `Params.pinoHttp` IS pino-http's `Options`.
- **Files modified:** services/games/src/observability/pino-config.ts, services/wallets/src/observability/pino-config.ts
- **Commit:** `bff3a3b`

**2. [Rule 3 — Blocking] `exactOptionalPropertyTypes: true` rejects `transport: undefined`**
- **Found during:** Task 2 tsc check
- **Issue:** `transport: process.env.NODE_ENV !== "production" ? {...} : undefined` violates tsconfig.exactOptionalPropertyTypes — an optional property cannot be explicitly assigned `undefined`.
- **Fix:** Switched to a guard: declare `base` without `transport`, then `if (!isProd) base.transport = {...}`. Result is identical (property absent in prod, present in dev) and ts-strict-clean.
- **Files modified:** services/games/src/observability/pino-config.ts, services/wallets/src/observability/pino-config.ts
- **Commit:** `bff3a3b`

**3. [Rule 1 — Bug] Removed `afterAll(() => sdk.shutdown())` from init-order test — caused 5s hook timeout**
- **Found during:** Task 1 GREEN test run
- **Issue:** The test ran 3 assertions and then `afterAll` invoked `sdk.shutdown()` which awaits the OTLP exporter flush; with no Jaeger collector reachable (Wave 2), the flush hangs for the default 5s hook timeout.
- **Fix:** Removed the afterAll cleanup. The sdk is process-scoped; bun test exits the process at the end of the test file and Node's normal teardown cancels the pending OTLP request. No leaked state because each test process is independent.
- **Files modified:** services/games/tests/unit/observability/tracing-init-order.test.ts, services/wallets/tests/unit/observability/tracing-init-order.test.ts
- **Commit:** `f3fb0b3` (test edit landed in the same commit as the implementation that turned it green)

No Rule 4 architectural changes. No user permission was needed for any of the above.

## Auth gates / human-action events

None.

## Stack already up — container rebuilds deferred

Per the plan-author note in the executor prompt: `docker compose build games wallets` was NOT run as part of this plan because Jaeger lands in 10-04 and Prometheus in 10-05 — running the new image now against a non-existent collector would just produce noisy `ECONNREFUSED` retries from the OTLP exporter without observable benefit. The next container rebuild (Wave 2 / plan 10-04) will pick up the tracing.ts entry naturally.

## Files touched (canonical paths)

Created:
- `/Users/pedro/Projetos/fullstack-challenge/services/games/src/tracing.ts`
- `/Users/pedro/Projetos/fullstack-challenge/services/games/src/observability/observability.module.ts`
- `/Users/pedro/Projetos/fullstack-challenge/services/games/src/observability/pino-config.ts`
- `/Users/pedro/Projetos/fullstack-challenge/services/games/tests/unit/observability/tracing-init-order.test.ts`
- `/Users/pedro/Projetos/fullstack-challenge/services/games/tests/unit/observability/pino-config.test.ts`
- `/Users/pedro/Projetos/fullstack-challenge/services/wallets/src/tracing.ts`
- `/Users/pedro/Projetos/fullstack-challenge/services/wallets/src/observability/observability.module.ts`
- `/Users/pedro/Projetos/fullstack-challenge/services/wallets/src/observability/pino-config.ts`
- `/Users/pedro/Projetos/fullstack-challenge/services/wallets/tests/unit/observability/tracing-init-order.test.ts`
- `/Users/pedro/Projetos/fullstack-challenge/services/wallets/tests/unit/observability/pino-config.test.ts`

Modified:
- `/Users/pedro/Projetos/fullstack-challenge/services/games/src/main.ts`
- `/Users/pedro/Projetos/fullstack-challenge/services/games/src/app.module.ts`
- `/Users/pedro/Projetos/fullstack-challenge/services/wallets/src/main.ts`
- `/Users/pedro/Projetos/fullstack-challenge/services/wallets/src/app.module.ts`

## Commits

| # | Hash | Type | Description |
| - | ---- | ---- | ----------- |
| 1 | `fd58813` | test | RED — failing init-order guards for tracing.ts first import |
| 2 | `f3fb0b3` | feat | GREEN — init OTel NodeSDK as literal-first import in both services |
| 3 | `facd52b` | test | RED — failing pino-config tests for customProps + redact + transport gating |
| 4 | `bff3a3b` | feat | GREEN — compose ObservabilityModule with pino + OTel + traceId/correlationId enrichment |

## Verification

| Check | Result |
| ----- | ------ |
| `head -1 services/games/src/main.ts` | `import "./tracing";` (Footgun #1 gate matched) |
| `head -1 services/wallets/src/main.ts` | `import "./tracing";` (Footgun #1 gate matched) |
| `cd services/games && bunx tsc --noEmit` | clean |
| `cd services/wallets && bunx tsc --noEmit` | clean |
| `cd services/games && bun test tests/unit/observability/` | 8/8 pass (3 init-order + 5 pino-config) |
| `cd services/wallets && bun test tests/unit/observability/` | 8/8 pass (3 init-order + 5 pino-config) |
| `cd services/games && bun test tests/unit` | 289 pass / 8 fail (8 baseline clock-mock failures unchanged: RoundLoopService 3 + MultiplierBroadcastService 4 + GetWsSnapshotUseCase 1 — see Phase 6 deferred-items.md) |
| `cd services/wallets && bun test tests/unit` | 33 pass / 0 fail (was 28; +5 new pino-config) |
| `grep -q ObservabilityModule services/games/src/app.module.ts` | matched |
| `grep -q ObservabilityModule services/wallets/src/app.module.ts` | matched |
| `grep -q redact services/games/src/observability/pino-config.ts` | matched |
| `grep -q redact services/wallets/src/observability/pino-config.ts` | matched |
| `grep -q trace.getActiveSpan services/games/src/observability/pino-config.ts` | matched |
| `grep -q "cls.get" services/games/src/observability/pino-config.ts` | matched |

## Known Stubs

None — every component wired in this plan reads from a real source (OTel current span, CLS context, typed env). No hardcoded placeholder data.

## Threat Flags

None new. The plan's existing threat register (T-10-05 PII/auth disclosure, T-10-06 OTLP target, T-10-07 init-order tampering, T-10-08 pino-pretty DoS) is fully mitigated as designed:

- T-10-05 — `redact: { paths: [req.headers.authorization, req.headers.cookie], remove: true }` covered by pino-config.test.ts test 5
- T-10-06 — OTLP endpoint defaults to in-compose `http://jaeger:4318/v1/traces` (10-01 typed env default, no public collector)
- T-10-07 — `head -1 main.ts` source-grep gate enforced by tracing-init-order.test.ts tests 1+2
- T-10-08 — transport gated on `NODE_ENV !== "production"` covered by pino-config.test.ts tests 3+4

No NEW security surface was introduced by this plan: no new HTTP routes, no new AMQP bindings, no new file IO, no new schema changes. The OTLP HTTP exporter is an outbound-only call to the internal hostname `jaeger:4318`.

## Self-Check: PASSED

All 10 created files verified present on disk:
- `services/games/src/tracing.ts` — FOUND
- `services/games/src/observability/observability.module.ts` — FOUND
- `services/games/src/observability/pino-config.ts` — FOUND
- `services/games/tests/unit/observability/tracing-init-order.test.ts` — FOUND
- `services/games/tests/unit/observability/pino-config.test.ts` — FOUND
- `services/wallets/src/tracing.ts` — FOUND
- `services/wallets/src/observability/observability.module.ts` — FOUND
- `services/wallets/src/observability/pino-config.ts` — FOUND
- `services/wallets/tests/unit/observability/tracing-init-order.test.ts` — FOUND
- `services/wallets/tests/unit/observability/pino-config.test.ts` — FOUND

All 4 commits verified in `git log`:
- `fd58813` test(10-03): add failing init-order guards for tracing.ts first import
- `f3fb0b3` feat(10-03): init OTel NodeSDK as literal-first import in both services
- `facd52b` test(10-03): add failing pino-config tests for customProps + redact + transport gating
- `bff3a3b` feat(10-03): compose ObservabilityModule with pino + OTel + traceId/correlationId enrichment
