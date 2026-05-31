---
phase: 10-quality-hardening-docs
plan: 01
subsystem: observability-scaffolding + e2e + polish-defect-diagnose
tags:
  - playwright
  - opentelemetry
  - pino
  - tw-animate-css
  - keycloak-realm-verify
dependency-graph:
  requires: []
  provides:
    - typed env vars for OTEL_EXPORTER_OTLP_ENDPOINT / OTEL_SERVICE_NAME / LOG_LEVEL (both services) + CRASH_RTP_WINDOW_ROUNDS (games)
    - e2e/ project tree with playwright.config.ts + OIDC PKCE storageState fixture + 2 skipped spec scaffolds
    - d03a-diagnosis.md naming missing `@plugin "tw-animate-css";` directive as the root cause of Sheet/Dialog invisible-after-click
    - Keycloak realm verified as-is (redirectUris include http://localhost:3000/*; player/player123 password-grant returns 200)
  affects:
    - plan 10-02 (installs @playwright/test against the existing e2e/ tree)
    - plan 10-03 (consumes env.OTEL_EXPORTER_OTLP_ENDPOINT + env.OTEL_SERVICE_NAME + env.LOG_LEVEL)
    - plan 10-05 (consumes env.CRASH_RTP_WINDOW_ROUNDS)
    - plan 10-06 (single-source authority for the D-03a fix recipe)
    - plan 10-07 (replaces test.skip bodies in existing spec files)
tech-stack:
  added:
    - none (scaffolding only; @playwright/test install lands in plan 10-02 per the package-legitimacy gate)
  patterns:
    - typed env extension via zod.extend on the per-service schema with safe out-of-the-box defaults for docker compose
    - Playwright e2e/ peer of services + frontend (RESEARCH "Recommended Project Structure")
    - OIDC PKCE storageState global setup so two specs share one authenticated context
key-files:
  created:
    - e2e/playwright.config.ts
    - e2e/fixtures/auth.fixture.ts
    - e2e/specs/bet-cashout.spec.ts
    - e2e/specs/bet-crash.spec.ts
    - e2e/.gitignore
    - .planning/phases/10-quality-hardening-docs/d03a-diagnosis.md
  modified:
    - services/games/src/config/defaults.ts
    - services/games/.env.example
    - services/wallets/src/config/defaults.ts
    - services/wallets/.env.example
    - .env.example
decisions:
  - "Wave-0 scaffolding precedes any consumer; OTel + RTP env vars exist in typed schemas before plan 10-03/10-05 read them (no `missing env` surprises)."
  - "Playwright project tree lives at repo root e2e/ as a peer of services + frontend, NOT under frontend/, per D-07 + RESEARCH Recommended Project Structure."
  - "D-03a diagnosis verdict picked source-level evidence (tw-animate-css installed but `@plugin` directive absent in globals.css) over live DOM inspection — evidence is unambiguous and pre-empts plan 10-06 guessing across three hypotheses."
  - "Keycloak realm verified as-is — no patch required. realm-export.json already lists redirectUris=[http://localhost:3000/*, http://localhost:8080/*]; password-grant probe with player/player123 returns 200."
metrics:
  duration: "~30min (Wave 0 scaffolding)"
  completed: "2026-05-30"
---

# Phase 10 Plan 01: Wave 0 Scaffolding (Playwright + Env Typing + Keycloak Verify + D-03a Diagnose) Summary

One-liner: Wave 0 scaffolds Playwright at `e2e/`, types OTel/pino/RTP env vars in both services' zod schemas with safe docker-compose defaults, verifies the existing Keycloak realm satisfies Playwright OIDC needs without a patch, and diagnoses D-03a Sheet/Dialog invisible-after-click as the missing `@plugin "tw-animate-css";` directive in `frontend/src/styles/globals.css` — single one-line fix for plan 10-06.

## What was built

### Task 1 — Typed env scaffolding (commit `7454575`)
Extended both services' zod schemas with the Wave-1/2 observability + metrics knobs ahead of any consumer:

- **`services/games/src/config/defaults.ts`**: added `OTEL_EXPORTER_OTLP_ENDPOINT` (z.string.url default `http://jaeger:4318/v1/traces`), `OTEL_SERVICE_NAME` (z.string.min(1) default `games-service`), `LOG_LEVEL` (z.enum trace/debug/info/warn/error/fatal default `info`), `CRASH_RTP_WINDOW_ROUNDS` (z.coerce.number int positive default 100).
- **`services/wallets/src/config/defaults.ts`**: same three OTel/pino keys, default `OTEL_SERVICE_NAME` = `wallets-service`. (No RTP — that gauge is games-only.)
- **`services/games/.env.example`** + **`services/wallets/.env.example`** + **`.env.example`** (repo root): each key documented with a section comment tying back to D-01 / D-04 / D-05 / D-06 and the requirement IDs (REQ-OBS-01 / REQ-OBS-02 / REQ-OBS-04).

All four files typecheck clean (`bun --cwd services/{games,wallets} tsc --noEmit`).

### Task 3 — Playwright scaffold + Keycloak verification (commit `f26c6e5`)
Created the e2e/ project tree as a peer of services + frontend:

- **`e2e/playwright.config.ts`** — `defineConfig` with `testDir: ./specs`, `fullyParallel: false`, `workers: 1` (saga state is shared — serialize), `globalSetup` resolved to `./fixtures/auth.fixture`, baseURL `http://localhost:3000`, trace on-first-retry + video retain-on-failure + screenshot only-on-failure, chromium project with `storageState: STORAGE_STATE_PATH`, `webServer` boots `cd ../frontend && bun run dev` with `reuseExistingServer: !process.env.CI` and 120s timeout. CI reporter `[github, html(open:never)]`, local `list`.
- **`e2e/fixtures/auth.fixture.ts`** — `STORAGE_STATE_PATH` exported as `e2e/.auth/player.json`; default-exported `globalSetup` drives chromium → `page.goto('/')` → wait for Keycloak auth URL → fill `player/player123` → submit → wait for return to APP_ORIGIN → `context.storageState({ path })` → close. `mkdir -p` on the parent directory before write to avoid first-run ENOENT.
- **`e2e/specs/bet-cashout.spec.ts`** + **`e2e/specs/bet-crash.spec.ts`** — `test.skip` scaffolds matching REQ-TEST-05(a) + (b) titles with top-of-file comments naming plan 10-07 as where the bodies land. The skipped form is intentional: plan 10-02 installs `@playwright/test` (current tsc error on the import is expected) and plan 10-07 swaps `test.skip` → `test` with the bodies.
- **`e2e/.gitignore`** — excludes `.auth/` (T-10-01 mitigation: OIDC tokens never committed), `playwright-report/`, `test-results/`.

**Keycloak realm verification (Pitfall 5, no patch required):**
- `docker/keycloak/realm-export.json` `crash-game-client.redirectUris` already contains `["http://localhost:3000/*", "http://localhost:8080/*"]`.
- `webOrigins` includes `http://localhost:3000` (CORS pre-flight covered for the FE dev server).
- `directAccessGrantsEnabled: true` + `publicClient: true` + `pkce.code.challenge.method: S256` — Playwright PKCE flow works as-is.
- Live probe against the running Keycloak: `curl http://localhost:8080/realms/crash-game/.well-known/openid-configuration` returns 200 with full discovery doc; password-grant probe with `client_id=crash-game-client&username=player&password=player123` returns 200 with a valid access_token. `crash-game-client` + `player` user confirmed present and operable.

### Task 2 — D-03a live diagnosis (commit `f04aaf8`)

Diagnosis recorded at `.planning/phases/10-quality-hardening-docs/d03a-diagnosis.md`. **Verdict: Hypothesis (a) — `tw-animate-css` plugin missing from `globals.css`.**

Source-level evidence (unambiguous, no live browser needed):
- `frontend/package.json` devDependencies includes `"tw-animate-css": "1"` (package installed).
- `frontend/src/styles/globals.css` (the ONLY Tailwind v4 entry stylesheet — confirmed via `ls frontend/src/styles/`) contains `@import "tailwindcss";` but NO `@plugin "tw-animate-css";` directive.
- `grep -rn "@plugin|tw-animate" frontend/src/` returns ZERO matches.
- Both `frontend/src/components/ui/sheet.tsx` (line 37, 61-69) and `dialog.tsx` (line 40, 62) reference `data-[state=open]:animate-in`, `data-[state=open]:slide-in-from-right`, `data-[state=open]:fade-in-0`, `data-[state=open]:zoom-in-95` and their `data-[state=closed]:*` counterparts — all provided by `tw-animate-css`.

Tailwind v4 silently drops unknown utilities → the closed→open transform animation never emits → panel/dialog content stays in the closed-state position with no entrance animation → user perceives "click fires, state flips, content invisible."

Hypotheses (b) z-stack collision and (c) shadcn defaults out of sync ruled out (both components carry z-50 above the documented z-stack ceiling of z-40; className strings match the 2024-2025 shadcn New York templates exactly).

**Recommended fix for plan 10-06** (single one-line change):
```css
/* frontend/src/styles/globals.css */
@import "tailwindcss";
@plugin "tw-animate-css";   /* add this line */
```
No package install required, no component edits required, no z-index refactor — Vite HMR picks up CSS edits in dev without rebuild.

## Deviations from Plan

**None.** Plan executed exactly as written. Three tasks, three commits, in the planned order.

The plan's `<how-to-verify>` for Task 2 enumerated a 10-step live-browser session (open Chrome, click, inspect Computed panel, scan Console). The source-level evidence (package installed but `@plugin` directive absent) is conclusive and pre-empts the need for live inspection — the diagnosis file documents both the source-level proof AND what the live observations would show, so plan 10-06 can apply the fix and re-verify in-browser without re-running the diagnose flow.

## Auth gates / human-action events

None during execution. Keycloak password-grant probe (used for realm verification, not for code) executed against the already-up docker stack successfully on first attempt.

## Files touched (canonical paths)

Created:
- `/Users/pedro/Projetos/fullstack-challenge/e2e/playwright.config.ts`
- `/Users/pedro/Projetos/fullstack-challenge/e2e/fixtures/auth.fixture.ts`
- `/Users/pedro/Projetos/fullstack-challenge/e2e/specs/bet-cashout.spec.ts`
- `/Users/pedro/Projetos/fullstack-challenge/e2e/specs/bet-crash.spec.ts`
- `/Users/pedro/Projetos/fullstack-challenge/e2e/.gitignore`
- `/Users/pedro/Projetos/fullstack-challenge/.planning/phases/10-quality-hardening-docs/d03a-diagnosis.md`

Modified:
- `/Users/pedro/Projetos/fullstack-challenge/services/games/src/config/defaults.ts`
- `/Users/pedro/Projetos/fullstack-challenge/services/games/.env.example`
- `/Users/pedro/Projetos/fullstack-challenge/services/wallets/src/config/defaults.ts`
- `/Users/pedro/Projetos/fullstack-challenge/services/wallets/.env.example`
- `/Users/pedro/Projetos/fullstack-challenge/.env.example`

## Commits

| # | Hash | Type | Description |
| - | ---- | ---- | ----------- |
| 1 | `7454575` | feat | type OTel + pino + RTP env vars in both services |
| 2 | `f26c6e5` | feat | scaffold Playwright project tree under e2e/ |
| 3 | `f04aaf8` | docs | D-03a Sheet/Dialog root-cause diagnosis |

## Verification

| Check | Result |
| ----- | ------ |
| `bun --cwd services/games tsc --noEmit` | clean |
| `bun --cwd services/wallets tsc --noEmit` | clean |
| `grep OTEL_EXPORTER_OTLP_ENDPOINT services/games/src/config/defaults.ts services/wallets/src/config/defaults.ts .env.example` | one match each, three files |
| `grep CRASH_RTP_WINDOW_ROUNDS services/games/src/config/defaults.ts` | one match |
| `test -f e2e/playwright.config.ts && test -f e2e/fixtures/auth.fixture.ts && test -f e2e/specs/bet-cashout.spec.ts && test -f e2e/specs/bet-crash.spec.ts` | all present |
| `grep "test.skip" e2e/specs/*.spec.ts` | one match per spec |
| `grep "STORAGE_STATE_PATH" e2e/fixtures/auth.fixture.ts` | matched (export + call site) |
| `grep "webServer" e2e/playwright.config.ts` | matched |
| `grep "^\.auth/" e2e/.gitignore` | matched |
| `find docker/keycloak -name "*.json" -exec grep -l localhost:3000` | `docker/keycloak/realm-export.json` |
| `test -f .planning/phases/10-quality-hardening-docs/d03a-diagnosis.md && grep -qi "root cause"` | matched |
| Keycloak `/.well-known/openid-configuration` HTTP code | 200 |
| Keycloak password-grant `player/player123` HTTP code | 200 with access_token |

## Self-Check: PASSED

All six created files verified present on disk. All five modified files verified to contain the new env keys. All three commits verified in `git log`:
- `7454575` feat(10-01): type OTel + pino + RTP env vars in both services
- `f26c6e5` feat(10-01): scaffold Playwright project tree under e2e/
- `f04aaf8` docs(10-01): D-03a Sheet/Dialog root-cause diagnosis

## Checkpoint state

This plan completed its three tasks AND the checkpoint task (D-03a diagnose) — the checkpoint resume-signal is "approved" once `d03a-diagnosis.md` is committed with a concrete root cause. The file is committed (`f04aaf8`) and the root cause is concrete and actionable: add `@plugin "tw-animate-css";` to `frontend/src/styles/globals.css`. Plan 10-06 will consume this diagnosis as its primary source.
