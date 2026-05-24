# ADR-005: Wallet seed strategy — first-login provisioning

**Status**: Accepted
**Date**: 2026-05-24
**Phase**: 1

## Context

REQ-DOC-03 reads: "Demo user `player/player123` is pre-configured in Keycloak with a wallet provisioned and seeded with 1000.00 CRD." The phrasing "pre-configured" is ambiguous and admits three concrete implementations:

- **Option A**: seed a wallet row at infrastructure bring-up via a one-shot SQL container that runs after the wallets-migrate container completes.
- **Option B**: seed the wallet on `wallets-service` boot via a `SEED_DEMO_USER=true` env flag that runs a bootstrap-only handler.
- **Option C**: provision the wallet on the first authenticated `POST /wallets` call, leveraging REQ-WALL-01's idempotency contract — "calling POST /wallets twice for the same user returns the existing wallet."

The decision is constrained by the layered roadmap principle: Phase 1 is foundation and infra, Phase 3 is the wallet service domain. The wallet schema does not exist in Phase 1 — it ships in Phase 3 (`packages/wallets/src/infrastructure/mikro-orm/migrations/`). Any Phase 1 strategy that materializes wallet rows or wallet tables breaks the phase boundary and pre-empts decisions that belong to Phase 3.

REQ-WALL-01 already mandates idempotent provisioning. REQ-DOC-03's "pre-configured" must be interpreted in light of that contract — not as "row exists at bring-up" but as "the system gives the demo user a wallet without manual recruiter intervention." The two phrasings are equivalent if the first authenticated page load reliably triggers `POST /wallets`.

The initial balance value comes from `INITIAL_BALANCE_CENTS=100000` per the config contract locked in ADR-004 (RESEARCH §7 OD1). Hardcoding 1000.00 anywhere in the codebase would violate REQ-INFRA-05.

## Considered

- **Option A — one-shot SQL seed container after `wallets-migrate`**. Forces the wallets schema (table + CHECK constraint per REQ-DOM-05) to ship in Phase 1 to give the SQL something to insert into. Pre-empts Phase 3 work. Couples the schema-creation phase to the seed-data phase, which inverts the layered roadmap.
- **Option B — boot seeder in `wallets-service` via `SEED_DEMO_USER=true` env flag**. Lives in the service code (Phase 3) as a bootstrap-only handler that checks for the demo user and inserts a wallet row if missing. Cleanly opt-in via env. Couples bootstrap logic into the wallet service when the same outcome is reachable via the existing REQ-WALL-01 path.
- **Option C — first-login provisioning via the REQ-WALL-01 idempotent `POST /wallets`**. The frontend (Phase 7) calls `POST /wallets` on first authenticated page load. The wallet service implements it idempotently per REQ-WALL-01. The initial balance flows from `INITIAL_BALANCE_CENTS=100000` (env, set in P1.7). For recruiters who run only the Docker compose without the frontend, the README documents a one-liner `curl` command that triggers the same endpoint with a valid JWT.

## Decision

**Option C — first-login provisioning.**

The frontend (Phase 7) calls `POST /wallets` on the first authenticated page load. The wallet service (Phase 3) implements this endpoint idempotently per REQ-WALL-01: if a wallet already exists for the player, return the existing wallet; otherwise create one with balance `INITIAL_BALANCE_CENTS=100000`. The initial-balance value is read from the env-typed `defaults.ts` (per ADR-004), not hardcoded anywhere.

The recruiter UX flow is: open the frontend → click "Login" → Keycloak SSO with `player/player123` → return to the frontend → the page loader calls `POST /wallets` → wallet appears with 1000.00 CRD. One click from cold-start to a usable wallet.

For recruiters who skip the frontend and explore the API directly (`docker compose up` + Postman), the README provides a documented `curl` command that obtains a token from Keycloak and POSTs to `/wallets`. This is a deliberate trade-off: the optimization here is "no Phase 1 wallet schema, no Phase 3 bootstrap logic" — and that trade-off costs the recruiter exactly one curl command if they want to verify the wallet without opening the browser.

If recruiter usability becomes a concern during Phase 1 verification, Phase 3 retains the option to layer in Option B (the `SEED_DEMO_USER=true` opt-in seeder) without revisiting this ADR. Option B is forward-compatible because it would call the same idempotent path Option C exercises.

Rationale, per RESEARCH §8 Demo wallet seed strategy (lines 1088-1106) and ASSUMPTION A6: Option C aligns the demo flow with the production-shaped REQ-WALL-01 idempotency contract, which is the same code path real users would take. Options A and B require bypass code that exists only for the demo and has to be maintained alongside the real path.

## Consequences

- **Phase 1 ships**: zero wallet schema and zero wallet seed code. The phase boundary stays clean.
- **Phase 3 ships**: the idempotent `POST /wallets` endpoint that creates a wallet with `INITIAL_BALANCE_CENTS` for the calling player if one does not already exist (REQ-WALL-01).
- **Phase 7 ships**: a frontend page loader that calls `POST /wallets` once after authentication completes.
- **README documents**: the manual `curl` flow for recruiters who skip the frontend, including how to obtain a Keycloak access token for `player/player123`.
- **REQ-DOC-03's "pre-configured" is interpreted** as: "the Keycloak user exists from realm import (P1.2), and the wallet auto-provisions on first authenticated call to `POST /wallets`, with the 1000.00 CRD value flowing from `INITIAL_BALANCE_CENTS`."
- **Foreclosed (for Phase 1)**: any wallet-row insertion, any wallet-schema materialization, any bootstrap-only handler that lives in the service.
- **Reversibility**: Phase 3 can layer in Option B (`SEED_DEMO_USER=true`) as an opt-in additive if recruiter UX feedback demands it — no Phase 1 change required.

## Alternatives Rejected

- **Option A — one-shot SQL seed container** — forces the wallets schema to materialize in Phase 1; pre-empts Phase 3's REQ-DOM-05 CHECK constraint work; couples infra-layer phase to domain-layer phase against the layered-roadmap principle.
- **Option B — boot seeder via `SEED_DEMO_USER=true`** — couples bootstrap-only logic into the wallet service when Option C achieves the same recruiter-observable outcome via the production code path. Available as a forward-compatible fallback in Phase 3 if needed; not the right Phase 1 commitment.
