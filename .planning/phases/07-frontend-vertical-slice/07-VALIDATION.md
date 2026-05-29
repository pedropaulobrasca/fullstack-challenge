---
phase: 7
slug: frontend-vertical-slice
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-28
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `07-RESEARCH.md` §Validation Architecture. The `frontend/` workspace is an empty slot — Wave 0 (07-02 spike + 07-03 scaffold) establishes all test infrastructure.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (`vitest` + `@testing-library/react` + `jsdom`) for unit/component; Playwright 1.49+ for full E2E (deferred to Phase 10, REQ-TEST-05) |
| **Config file** | none yet — 07-03 creates `frontend/vitest.config.ts` (reuses Vite config: `@/*` alias, workspace-TS transpile) |
| **Quick run command** | `cd frontend && bun run test` (single-file vitest run) |
| **Full suite command** | `cd frontend && bun run test` + root `bun run typecheck` + `bun run lint` |
| **Estimated runtime** | ~15 seconds (vitest unit/component) |

> Rationale: FE needs jsdom + RTL + Vite transform pipeline (Tailwind, alias, workspace TS) — Vitest reuses the Vite config natively. Backend stays on `bun:test`; FE is the one place Vitest earns its keep. First Vitest in the repo.

---

## Sampling Rate

- **After every task commit:** `cd frontend && bun run test` (changed-area) + `bun run typecheck`
- **After every plan wave:** full `frontend` vitest + `bun run lint` (with the `.tsx` money-rule glob from 07-01) + `bun run typecheck`
- **Before `/gsd:verify-phase`:** full vitest green + typecheck + lint clean; live manual smoke against `docker:up` (login → bet → watch curve → cashout → balance update)
- **Max feedback latency:** ~15 seconds

---

## Per-Requirement Verification Map

| Requirement | Plan | Wave | Behavior | Test Type | Automated Command | File Exists |
|-------------|------|------|----------|-----------|-------------------|-------------|
| REQ-FE-03 | 06 | 4 | EWMA offset reducer converges, never snaps; `multiplierAt` anchor math | unit | `vitest run src/features/game/ewma.test.ts` | ❌ W0 |
| REQ-FE-04 | 01,05 | 1,4 | Bet input rejects negative / scientific / >2dp / out-of-bounds; accepts valid | unit | `vitest run src/features/bet/validate-bet-amount.test.ts` | ❌ W0 |
| REQ-FE-05 | 05 | 4 | Live payout = `stake.multiplyRounded(m)` matches Money math | unit | `vitest run src/features/bet/payout.test.ts` | ❌ W0 |
| REQ-FE-07/08 | 04,07 | 3,4 | WS event → correct Zustand slice; feed circular buffer cap; history prepend on crash | unit | `vitest run src/stores/*.test.ts` | ❌ W0 |
| REQ-FE-13 | 08 | 5 | Toast dedupe by id; skeleton renders on loading state | component | `vitest run src/features/**/*.test.tsx` | ❌ W0 |
| REQ-AUTH-01 | 02,04 | 1,3 | Unauth route redirects (guard invoked) | component | `vitest run src/auth/*.test.tsx` (mock oidc) | ❌ W0 |
| REQ-FE-02/14 | 06,08 | 4,5 | Canvas draws (smoke), crash freeze == server value | component (jsdom canvas stub) / manual | manual + `vitest` smoke | ❌ W0 |
| Full player loop | — | — | login → bet → cashout / crash | E2E | Playwright (Phase 10 REQ-TEST-05) | ❌ P10 |

*Status: ⬜ pending until Wave 0 establishes the harness.*

---

## Wave 0 Requirements

- [ ] `frontend/vitest.config.ts` — reuses Vite config (alias, workspace-TS transpile) — 07-03
- [ ] `frontend/src/test/setup.ts` — jsdom + Testing Library + canvas stub + `matchMedia` mock (reduced-motion) — 07-03
- [ ] `frontend/tsconfig.json` — self-contained (no root tsconfig — Pitfall 8) — 07-03
- [ ] Framework install: `bun add -d vitest @testing-library/react @testing-library/jest-dom jsdom @vitejs/plugin-react` — 07-03
- [ ] eslint: extend `**/*.tsx` into the `@crash/no-number-for-money` glob (Pitfall 7) — 07-01
- [ ] Gating spikes (non-test): SPA-vs-SSR boot (Pitfall 1), OIDC token-parity + two-tab (Open Q1, Pitfall 5), workspace-TS + dinero/bigint resolution (Pitfall 8), Kong CORS reachability (Pitfall 2) — 07-02

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Canvas curve visual smoothness at 60fps | REQ-FE-02 | jsdom has no real raster; fps is perceptual | `docker:up`, log in, watch a RUNNING round — curve climbs smoothly, no jank |
| Crash flash + freeze overlay | REQ-FE-14 | visual/timing | trigger a crash, confirm red flash + brief freeze at server crash value |
| Multi-tab single coordinated refresh | REQ-AUTH-03 | needs 3 real browser tabs + BroadcastChannel | open 3 tabs, wait for token rotation, confirm one coordinated refresh (spike in 07-02) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags (vitest `run`, not watch)
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-28
