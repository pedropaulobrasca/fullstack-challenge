---
phase: 10-quality-hardening-docs
plan: 02
subsystem: observability-deps
tags: [bun, otel, pino, prometheus, playwright, deps]
requires:
  - 10-01 (Playwright scaffold + env vars)
provides:
  - "@opentelemetry/* SDK + nestjs-otel in games + wallets (enables 10-03 OTel bootstrap)"
  - "nestjs-pino + pino in games + wallets (enables 10-04 logging plan)"
  - "@willsoto/nestjs-prometheus + prom-client in games + wallets (enables 10-05 metrics plan)"
  - "@playwright/test + chromium browser at repo root (enables 10-07 Playwright spec runs)"
affects:
  - services/games/package.json
  - services/wallets/package.json
  - package.json (root)
  - bun.lock
tech-stack:
  added:
    - "@opentelemetry/sdk-node@0.218.0"
    - "@opentelemetry/api@1.9.1"
    - "@opentelemetry/auto-instrumentations-node@0.76.0"
    - "@opentelemetry/exporter-trace-otlp-http@0.218.0"
    - "@opentelemetry/resources@2.7.1"
    - "@opentelemetry/semantic-conventions@1.41.1"
    - "nestjs-otel@6.2.0"
    - "nestjs-pino@4.6.1"
    - "pino@10.3.1"
    - "@willsoto/nestjs-prometheus@6.1.0 (corrected from PLAN-cited v11 — hallucination)"
    - "prom-client@15.1.3"
    - "@playwright/test@1.60.0 (root devDep)"
  patterns:
    - "Mirror install strategy across services/games + services/wallets so observability surface is symmetric"
    - "Playwright pinned at root because /e2e tree lives at root (not /frontend/e2e)"
key-files:
  modified:
    - services/games/package.json
    - services/wallets/package.json
    - package.json
    - bun.lock
decisions:
  - "D-02a: Pin @willsoto/nestjs-prometheus to ^6.1.0 (actual npm latest), not the v11 cited in PLAN/RESEARCH which does not exist on registry. nestjs-otel ^6.1.0 kept unchanged — downstream 10-03 written against v6 decorator surface."
  - "D-02b: Playwright installs at repo ROOT, not /frontend, because the e2e/ tree lives at root per 10-01 scaffold."
metrics:
  duration_seconds: 132
  completed: 2026-05-31
  tasks_total: 2
  tasks_completed: 2
  files_modified: 4
  commits: 3
---

# Phase 10 Plan 02: Install Observability + Playwright Deps Summary

Install OTel SDK + nestjs-otel + nestjs-pino + @willsoto/nestjs-prometheus + prom-client into both NestJS services and @playwright/test + chromium at repo root, unblocking Phase 10 Waves 1/2/3.

## What Was Built

Three atomic workspace installs executed against the corrected pin set after Option-1 deviation approval:

- **services/games**: 11 runtime packages added. `@willsoto/nestjs-prometheus` pinned to `^6.1.0` (the actual npm latest as of execution). All `@opentelemetry/*`, `nestjs-otel@^6.1.0`, `nestjs-pino@^4.6.1`, `pino@^10.3.1`, `prom-client@^15.1.3` landed.
- **services/wallets**: identical pin set, mirrored 1:1.
- **root**: `@playwright/test@^1.60.0` as devDep; `bunx playwright install --with-deps chromium` populated the ms-playwright cache (chrome-headless-shell-1223, ffmpeg-1011).

## Verification Outcome

All gates passed:

| Gate | Command | Result |
|------|---------|--------|
| Grep gate: unscoped absent | `! grep '"nestjs-prometheus"' services/games/package.json services/wallets/package.json` | PASS (0 matches) |
| Frozen lockfile from root | `bun install --frozen-lockfile` | exit 0 — "no changes" |
| Games typecheck | `cd services/games && bunx tsc --noEmit` | exit 0 |
| Wallets typecheck | `cd services/wallets && bunx tsc --noEmit` | exit 0 |
| Playwright runnable | `bunx playwright --version` | "Version 1.60.0" |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Plan bug] `@willsoto/nestjs-prometheus@^11.0.0` does not exist on npm**

- **Found during:** Task 1 Package Legitimacy gate — registry inspection of https://www.npmjs.com/package/@willsoto/nestjs-prometheus showed actual latest is `6.1.0`, not the `11.0.0` the RESEARCH "Standard Stack" line had cited.
- **Issue:** Plan would have failed on `bun add @willsoto/nestjs-prometheus@^11.0.0` with `No matching version`. The v11 figure appears to be a research-time hallucination (cross-contamination from the NestJS v11 major version line, perhaps).
- **Fix:** Pinned to `^6.1.0`. Compatible with installed Nest 11.x via the package's peerDependency range. `nestjs-otel@^6.1.0` left unchanged — independent package line, downstream 10-03 written against v6 decorator surface.
- **User decision:** Option 1 approved (correct only the `@willsoto/nestjs-prometheus` pin, keep `nestjs-otel@^6.1.0`).
- **Files modified:** services/games/package.json, services/wallets/package.json, .planning/phases/10-quality-hardening-docs/10-02-PLAN.md (must_haves.truths updated)
- **Commits:** 705a125 (games), feea60e (wallets)

**2. [Rule 3 - Location correction] Playwright install location root, not frontend**

- **Found during:** Task 2 — plan action text said "from `frontend/` run: `bun add -d @playwright/test`", but the e2e/ tree scaffolded by 10-01 lives at repo root, not under `frontend/`. Installing under `frontend/` would force a workspace cross-link for the root `e2e/playwright.config.ts` import resolution.
- **Fix:** `@playwright/test` added as ROOT devDep. `bunx playwright install --with-deps chromium` run from root.
- **Files modified:** package.json, bun.lock
- **Commit:** 0e4f75d

## Package Legitimacy Verification

The Task 1 blocking-human checkpoint was satisfied during the prior conversation turn. All 12 registry pages confirmed expected maintainer + repo + downloads. The only discrepancy was the `@willsoto/nestjs-prometheus` version — npm shows latest is `6.1.0`, not `11.0.0` as RESEARCH cited. The SCOPED-vs-unscoped distinction was honored: unscoped `nestjs-prometheus` is absent from both services per the grep gate.

## Commits

| Hash | Scope | Description |
|------|-------|-------------|
| 705a125 | games | install 11 OTel/pino/Prometheus deps |
| feea60e | wallets | mirror games install |
| 0e4f75d | root | @playwright/test + chromium browser |

## Downstream Unblocks

- **10-03** can now `import { NodeSDK } from "@opentelemetry/sdk-node"` + `import { LoggerModule } from "nestjs-pino"` in both services.
- **10-05** can now `import { makeCounterProvider, InjectMetric } from "@willsoto/nestjs-prometheus"` (v6 API — `makeCounterProvider` is exported in v6.x; downstream plan should be sanity-checked against v6 vs v11 surface if any v11-only export was assumed).
- **10-07** can now `bunx playwright test --config=e2e/playwright.config.ts`.

## Caveat for Wave 2 (10-05)

`@willsoto/nestjs-prometheus@6.x` predates v7+ API tweaks. If 10-05 was authored against v11-specific exports (e.g., newer provider helpers or refactored module shape), the wave 2 executor will hit deviation Rule 1 and need to adapt to the v6 surface. Both `PrometheusModule.register` and `makeCounterProvider/makeGaugeProvider/makeHistogramProvider` exist in v6, which covers the standard metrics-module shape. No defensive change made here.

## Threat Surface Scan

No new threat surface introduced. T-10-SC (supply-chain tampering) mitigated by the Task 1 human-verify gate. T-10-04 (typo-squat unscoped `nestjs-prometheus`) mitigated by the grep gate — both services confirmed clean.

## Self-Check: PASSED

- services/games/package.json @willsoto/nestjs-prometheus 6.1.0 — FOUND
- services/wallets/package.json @willsoto/nestjs-prometheus 6.1.0 — FOUND
- package.json @playwright/test 1.60.0 — FOUND
- unscoped nestjs-prometheus — absent in both services
- commits 705a125, feea60e, 0e4f75d — all reachable in `git log`
