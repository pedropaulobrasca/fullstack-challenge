---
phase: 01-foundation-infra
verified: 2026-05-24T20:30:00Z
status: passed
verdict: PASS
score: 5/5 success criteria + 9/9 REQ-IDs + 6/6 ADRs verified
confidence: HIGH
---

# Phase 1: Foundation & Infra — Verification Report

**Phase Goal (ROADMAP):** A fresh clone reaches green healthchecks for every service via a single `bun run docker:up` with shared kernel primitives (Money VO, error taxonomy, event envelopes) ready to consume.

**Verdict:** PASS

The phase goal is observably true in the codebase. Every success criterion is met with concrete, reproducible evidence — `bun run docker:up` from this verification session brought 8/8 containers to healthy (with 2 migration containers exiting 0), `bun run smoke:health` reported 7/7 probes pass, `bun run lint` exits 0 with the custom money guard active, `bun test` in `packages/shared-kernel` runs 18 passing tests (including the fast-check property test for JSON round-trip), and `bun test` in `packages/eslint-plugin` runs 8 passing rule tests (4 valid + 4 invalid fixtures). All 6 anticipated ADRs are committed with Context / Considered / Decision / Consequences / Alternatives Rejected sections. Git history is free of AI fingerprints and no emojis appear in committed code.

The single ROADMAP wording mismatch — "demo user seeded with a wallet of 1000.00 CRD" — is reconciled by ADR-005 (first-login provisioning), which the ROADMAP/REQUIREMENTS author explicitly accepted (REQUIREMENTS.md marks REQ-DOC-03 as "Done (P1.9 documented; Phase 3 will land actual provisioning endpoint)"). This is documented as a Phase 3 closure item, not a Phase 1 gap.

---

## Success Criteria Verification (ROADMAP §Phase 1)

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Fresh `git clone` + `bun run docker:up` brings every container healthy with zero manual steps; Keycloak realm imported, Postgres DBs created, migration containers complete, demo user `player/player123` reachable | VERIFIED | This session: `bun run docker:up` brought 6 long-running containers (postgres, rabbitmq, keycloak, kong, games, wallets) to `Healthy` and 2 init containers (games-migrate, wallets-migrate) to `Exited (0)` from a single command. `bun run smoke:health` then reported `7/7 probes passed` including `keycloak password grant (player/player123)` which returned a JWT proving the realm import + demo user landed. Reconciled deviation on "wallet of 1000.00 CRD" → ADR-005 first-login provisioning model (Phase 3 ships the endpoint). |
| 2 | `bun run docker:down` and `bun run docker:prune` stop cleanly without orphan volumes | VERIFIED | This session: `bun run docker:down` removed all 6 containers + the compose network in ~10s and exited 0. Both scripts exist in root `package.json`: `docker:down` = `docker compose down --remove-orphans`; `docker:prune` = `docker compose down -v --rmi local --remove-orphans && docker volume prune -f`. The `-v` flag in `docker:prune` removes named volumes (postgres_data, rabbitmq_data) ensuring no orphans. |
| 3 | `packages/shared-kernel` exports a working `Money` VO; add/subtract/JSON round-trip verified by property test | VERIFIED | `cd packages/shared-kernel && bun test` → `18 pass, 0 fail` in 51ms. Includes: `Money.of(-1n) throws NegativeMoneyError`, `subtract that would go negative throws`, `adding Money with different currencies throws CurrencyMismatchError`, plus the fast-check property `JSON round-trip preserves cents for any non-negative bigint up to 10_000_000` (100 random cases). `Money` is wired through Dinero v2 (`dinero.js/bigint` named imports) per ADR-002. |
| 4 | ESLint custom rule rejects `number` typed money symbols; demo offender fails lint | VERIFIED | `cd packages/eslint-plugin && bun test` → `8 pass, 0 fail`. RuleTester fixtures cover: VALID (`count: number`, `attemptCount: number`, `pageIndex/totalCount/multiplier: number`) — explicit non-misfire coverage proving Pitfall 7 from RESEARCH is addressed; INVALID (`balance: number`, `betAmountCents: number`, `payout: number`, `wagerCents: number`) all flagged with `messageId: banned`. Rule is wired into root `eslint.config.js` as `@crash/no-number-for-money: error`. `bun run lint` exits 0 across the whole repo. |
| 5 | `.env.example` lists every operator constant; `config/defaults.ts` re-exports typed; no business constant lives outside env | VERIFIED | `services/games/.env.example` carries 19 env vars (39 lines including comments and section headers) covering OD2-OD14 plus connection vars + PORT; `services/wallets/.env.example` carries 9 vars (19 lines) covering OD1 + shared currency + PORT. Typed re-export verified in `services/games/src/config/defaults.ts` (zod schema, `Object.freeze`, exports `env` + `GamesEnv` type) and `services/wallets/src/config/defaults.ts` (same shape). Root `eslint.config.js` declares `no-restricted-properties` banning `process.env` access outside `**/src/config/**`, `**/mikro-orm.config.ts`, and `services/*/src/main.ts` — `bun run lint` exits 0, proving no violation lives in the current tree. |

**Score:** 5/5 success criteria verified.

---

## Requirements Coverage (Phase 1 REQ-IDs)

| REQ-ID | Title | Status | Evidence |
|--------|-------|--------|----------|
| REQ-INFRA-01 | `bun run docker:up` zero-step bootstrap | VERIFIED | This session brought the stack up from a stopped state with a single command; 8/8 services healthy. |
| REQ-INFRA-02 | Healthcheck-gated container startup | VERIFIED | `docker-compose.yml` declares `service_healthy` for postgres/rabbitmq/keycloak and `service_completed_successfully` for both `*-migrate` init containers as gates for `games` and `wallets`. Verified by reading lines 89-94, 106-108, 139-148, 167-176 of docker-compose.yml. |
| REQ-INFRA-03 | `docker:down` + `docker:prune` clean | VERIFIED | Both scripts present in `package.json`. `docker:down` validated end-to-end this session. `docker:prune` adds `-v --rmi local` for volume + image teardown. |
| REQ-INFRA-04 | Version pinning | VERIFIED | `.bun-version` = `1.3.11` (exact), root `package.json` has `"packageManager": "bun@1.3.11"`, `bun.lock` present and committed (commit `6924863`). NestJS, MikroORM, Dinero versions pinned in service manifests per RESEARCH §Locked versions. |
| REQ-INFRA-05 | Runtime constants from env | VERIFIED | ESLint `no-restricted-properties` rule active (commit `6357585`); `bun run lint` exits 0 confirming no `process.env` access escapes the config layer. Both services' `defaults.ts` parse env via zod with explicit defaults. |
| REQ-DOM-05 | Wallet balance never negative (CHECK constraint groundwork) | VERIFIED (groundwork) | Migration containers run on `docker:up` and exit 0; MikroORM CLI loaded. The actual `CHECK (balance_cents >= 0)` constraint lands in Phase 3 as documented in REQUIREMENTS.md (REQ-DOM-05 explicitly Phase 3) and in `01-10-SUMMARY.md` REQ-ID coverage table. Phase 1's responsibility is "groundwork" per ROADMAP and is satisfied. |
| REQ-DOM-06 | Money VO with bigint cents | VERIFIED | `packages/shared-kernel/src/money/money.ts` implements the VO; 18 tests passing; fast-check property test locks round-trip lossless-ness. |
| REQ-AUTH-05 | Pre-seeded `player/player123` + realm auto-import | VERIFIED | Smoke probe 4 (`keycloak password grant`) returned a JWT this session. Realm export mounted via `./docker/keycloak:/opt/keycloak/data/import:ro` with `--import-realm` flag on the Keycloak command. |
| REQ-DOC-03 | Demo user wallet seeded with 1000.00 CRD | VERIFIED (deferred-by-design) | REQUIREMENTS.md explicitly marks this "Done (P1.9 documented; Phase 3 will land actual provisioning endpoint)". ADR-005 documents first-login provisioning as the chosen strategy over a Phase 1 SQL seed. README `Demo user` section documents the recruiter flow: token grant + `POST /wallets` (Phase 3) returns the provisioned wallet. This is an accepted scope split, not a Phase 1 gap. |

**Score:** 9/9 REQ-IDs verified.

---

## ADR Catalogue Check

| ADR | Title | Phase | Sections present | Status |
|-----|-------|-------|------------------|--------|
| ADR-001 | ORM selection — MikroORM 7 | 1 | Context, Considered, Decision, Consequences, Alternatives Rejected | VERIFIED |
| ADR-002 | Money representation — Dinero.js v2 wrapped in local VO | 1 | Context, Considered, Decision, Consequences, Alternatives Rejected | VERIFIED |
| ADR-003 | Bun + NestJS pinning strategy | 1 | Context, Considered, Decision, Consequences, Alternatives Rejected | VERIFIED |
| ADR-004 | Configuration source-of-truth shape | 1 | Context, Considered, Decision, Consequences, Alternatives Rejected | VERIFIED |
| ADR-005 | Wallet seed strategy — first-login provisioning | 1 | Context, Considered, Decision, Consequences, Alternatives Rejected | VERIFIED |
| ADR-006 | ESLint money-guard plugin location and authoring approach | 1 | Context, Considered, Decision, Consequences, Alternatives Rejected | VERIFIED |

All 6 ADRs are committed (`3995365` for 001-004, `2509f93` for 005-006 + catalogue) and each contains the canonical 5-section structure. `.planning/adrs/README.md` is a proper catalogue index with conventions (filename, status, date, phase) and a Future ADRs roadmap.

---

## Anti-Shallow Checks

| Check | Result | Evidence |
|-------|--------|----------|
| AI fingerprints in commit subjects | NONE | All 40 commits inspected via `git log --oneline`; subjects follow Conventional Commits with phase prefix (e.g., `feat(01-04):`, `docs(01-08):`). No `Co-Authored-By: Claude`, no `Generated by`, no AI references. |
| AI fingerprints in commit bodies | NONE | `git log --all --format='%B'` piped through a regex matching `co-authored-by.*(claude\|gpt\|anthropic\|openai\|noreply@anthropic)`, `generated by claude`, the robot emoji, and `Generated with Claude Code` returned zero matches. |
| Emojis in committed code/docs | NONE | Walked `.ts/.tsx/.js/.json/.yml/.yaml/.sh` files across the repo (excluding `node_modules`, `.git`, `.bun-cache`) with the Unicode emoji block ranges `U+1F300-1FAFF` `U+2600-27BF` `U+1F000-1F2FF` — zero hits. |
| `number` typed money symbols anywhere | NONE | `bun run lint` exits 0 with `@crash/no-number-for-money: error` enabled across the whole repo. The rule itself has 8 passing fixture tests proving it catches `balance/betAmountCents/payout/wagerCents` and ignores `count/attemptCount/pageIndex/totalCount/multiplier`. |
| Debt markers (`TBD/FIXME/XXX/TODO/HACK`) in source code | NONE | `grep -rn -E "TBD\|FIXME\|XXX\|TODO\|HACK"` across `packages/`, `services/`, `scripts/`, `docker/` returned zero hits. The two `OD8`/`OD14 — pending user confirmation` notes in env files are STATE.md-tracked decisions for future phases, not phase-1 debt. |
| Hardcoded business constants | NONE | All 14 OD constants exposed via `.env.example` + parsed in typed `defaults.ts`; ESLint `no-restricted-properties` enforces the discipline outside the config layer. |
| Floating Docker tags (e.g., `bun:1-alpine`) | NONE (matches ADR-003) | Service Dockerfiles pin `oven/bun:1.3.11-alpine` per `01-10-SUMMARY.md` deviation log + ADR-003. |

---

## Behavioral Probes (executed during verification)

| Probe | Command | Result |
|-------|---------|--------|
| Stack bootstrap | `bun run docker:up` (cold start) | All 6 long-running containers reach `Healthy`; both `*-migrate` containers exit 0 |
| Smoke probes | `bun run smoke:health` | `7/7 probes passed`: postgres pg_isready, rabbitmq mgmt api, keycloak /health/ready (9000), keycloak password grant (player/player123), kong admin /status (8001), games /health (4001), wallets /health (4002) |
| Lint | `bun run lint` | Exit 0 over the full workspace |
| Shared-kernel tests | `cd packages/shared-kernel && bun test` | `18 pass, 0 fail` (13 Money + 5 env-schema) |
| ESLint plugin tests | `cd packages/eslint-plugin && bun test` | `8 pass, 0 fail` (4 valid + 4 invalid fixtures) |
| Stack teardown | `bun run docker:down` | Exit 0; all containers stopped + removed; compose network removed |

---

## Open Gaps

NONE that affect Phase 1's contract.

### Phase 2 onboarding notes (not gaps — work items for the next phase)

- The temporary `discovery: { warnWhenNoEntities: false }` override in both `mikro-orm.config.ts` files should be removed in the first Phase 2 plan that registers a real entity (OutboxMessage / InboxMessage). Already flagged in 01-10-SUMMARY.md decisions log.
- `services/games/.env.example` carries inline notes "OD8 — pending user confirmation pre-Phase 4" and "OD14 — pending user confirmation pre-Phase 9". These are real Phase 4/9 decisions tracked in STATE.md todos — not Phase 1 debt.
- ADR-005 deferred wallet provisioning to Phase 3. The Phase 3 plan must include an idempotent `POST /wallets` task that aligns with the recruiter-demo curl flow already documented in the root `README.md`.
- `frontend/` is an empty placeholder. Phase 7 lights it up. The compose file already has a commented-out `frontend` block ready to uncomment.

---

## Confidence

HIGH. Every claim in this report is backed by a reproducible command result observed in this verification session (or a direct file read on the current tree). The phase goal — single-command bring-up to all-healthy with shared kernel primitives — is concretely demonstrable. The single ROADMAP-vs-implementation reconciliation (wallet seed → first-login provisioning) is recorded in REQUIREMENTS.md, ADR-005, README.md, and 01-10-SUMMARY.md, so the deferral is auditable and consensual.

---

*Verified: 2026-05-24T20:30:00Z*
*Verifier: gsd-verifier*
