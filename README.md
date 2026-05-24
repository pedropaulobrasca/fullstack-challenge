# Crash Game

Multiplayer real-time Crash game submitted as the Jungle Gaming fullstack technical challenge. Backend is two NestJS 11 services (`games`, `wallets`) running on Bun 1.3.11, with a RabbitMQ saga, Keycloak 26 OIDC, and PostgreSQL 18 via MikroORM 7. Frontend is TanStack Start with Socket.IO 4.8 for live multiplier push. Money never touches `number` — every amount is a `Money` value object backed by Dinero v2 with bigint cents. Round outcomes are provably fair via a Bustabit-style HMAC-SHA-256 hash chain consumed in reverse, with the pre-round commitment visible before any bet is accepted. The multiplier is server-authoritative; clients interpolate locally and reconcile to server ticks.

## Quickstart

**Prerequisites**

- Docker + Docker Compose v2 (running)
- Bun 1.3.11 (optional locally — every container ships with it)

**Commands**

```bash
bun install
```

Installs dev tooling and links the Bun workspaces (`services/*`, `packages/*`, `frontend`).

```bash
bun run docker:up
```

Brings the full stack up: Postgres, RabbitMQ, Keycloak, Kong, the `games-migrate` and `wallets-migrate` init containers, then the `games` and `wallets` services. The `--wait` flag blocks until every healthcheck passes.

```bash
bun run smoke:health
```

Runs the health probes described below and exits non-zero if any service is unreachable. Ships in P1.10.

```bash
bun run docker:down
```

Stops the stack and removes orphan containers without destroying volumes.

```bash
bun run docker:prune
```

Full reset — removes containers, volumes, and locally-built images. Use when you want a clean slate.

On the first `docker:up`, the Postgres init script creates the `games` and `wallets` databases, Keycloak imports the `crash-game` realm with its pre-seeded user and client, and both service migration containers run (no-ops in Phase 1 — the actual migrations ship in Phase 3 and Phase 4). All container healthchecks must pass before `docker:up` returns.

## Environment variables

Every business constant lives in env — nothing is hardcoded. The table below is the full Open Configuration surface; defaults come from each service's `.env.example`.

| Variable | Default | Service | Description |
|----------|---------|---------|-------------|
| `INITIAL_BALANCE_CENTS` | `100000` | wallets | First-login wallet provisioning amount (1000.00 CRD). |
| `CURRENCY_CODE` | `CRD` | both | ISO-like code for the in-game currency. |
| `CURRENCY_BASE` | `10` | both | Dinero `base` for the currency unit. |
| `CURRENCY_EXPONENT` | `2` | both | Dinero `exponent` — 2 decimal places. |
| `BETTING_WINDOW_MS` | `5000` | games | Duration of the BETTING phase per round. |
| `COOLDOWN_MS` | `2000` | games | Pause between SETTLED and the next BETTING phase. |
| `SERVER_TICK_HZ` | `30` | games | Multiplier broadcast frequency. |
| `GROWTH_RATE` | `0.06` | games | Exponent in `e^(GROWTH_RATE * t / 1000)`. |
| `INSTANT_CRASH_BUCKET` | `101` | games | One-in-N instant-crash probability for ~99% RTP. |
| `BET_MIN_CENTS` | `100` | games | Minimum bet (1.00 CRD). |
| `BET_MAX_CENTS` | `100000` | games | Maximum bet (1000.00 CRD). |
| `HASH_CHAIN_LENGTH` | `1000000` | games | Pre-generated hash chain depth. |
| `SAGA_TIMEOUT_MS` | `5000` | games | Bet saga timeout before auto-refund. |
| `OUTBOX_POLL_INTERVAL_MS` | `1000` | both | Fallback poll interval for the outbox publisher. |
| `RMQ_DELIVERY_LIMIT_MAIN` | `5` | both | `x-delivery-limit` on main queues. |
| `RMQ_DELIVERY_LIMIT_DLQ` | `3` | both | `x-delivery-limit` on dead-letter queues. |
| `AUTO_CASHOUT_MAX_X` | `100.00` | games | Upper bound on user-set auto-cashout targets. |
| `LEADERBOARD_WINDOW_HOURS` | `24` | games | Rolling window for the leaderboard projection. |
| `LEADERBOARD_TOP_N` | `10` | games | Number of entries returned by the leaderboard endpoint. |

Defaults live in each service's `src/config/defaults.ts` (a typed re-export parsed by zod). Override via `services/<name>/.env`. The root `.env.example` is a superset reference — do not load it directly; compose reads `services/<name>/.env`.

## Demo user

Keycloak's `crash-game` realm is auto-imported on first `docker:up` with the OIDC client `crash-game-client` (public, PKCE S256) and the demo user `player` / `player123`.

The wallet for `player` is not pre-seeded into the wallets database. Instead, it auto-provisions with `INITIAL_BALANCE_CENTS` (1000.00 CRD) on the first authenticated `POST /wallets` call — see [ADR-005](.planning/adrs/ADR-005-wallet-seed-strategy.md) for the rationale (first-login provisioning over one-shot SQL seed). During Phase 7, this happens automatically when the user logs in through the frontend.

Until the frontend ships, the wallet can be provisioned manually. First, obtain an access token via the Keycloak password grant:

```bash
TOKEN=$(curl -s -X POST \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=crash-game-client" \
  -d "username=player" \
  -d "password=player123" \
  http://localhost:8080/realms/crash-game/protocol/openid-connect/token \
  | jq -r .access_token)
```

Then provision and inspect the wallet through Kong:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:8000/wallets
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/wallets/me
```

The second call returns `{ balanceCents: "100000", currency: "CRD", ... }` once Phase 3 ships the wallet endpoints. In Phase 1 the auth path is verifiable end-to-end (token grant works, JWKS is reachable), but the `/wallets` routes return 404 from Kong because they are not declared yet — that's expected.

## Healthchecks

Each container ships its own healthcheck wired into compose. The manual equivalents below let a developer probe each service after `bun run docker:up`.

- **Postgres**: `docker compose exec postgres pg_isready -U admin` — expect `accepting connections`.
- **RabbitMQ**: `curl -u admin:admin http://localhost:15672/api/overview | jq .rabbitmq_version` — expect a `4.2.x` string.
- **Keycloak**: `curl -sf http://localhost:9000/health/ready` — expect HTTP 200 (Keycloak 26 splits the management port from the proxy port).
- **Kong**: `curl -sf http://localhost:8001/status` — expect HTTP 200 from the admin API.
- **Games**: `wget -qO- http://localhost:4001/health` — expect HTTP 200.
- **Wallets**: `wget -qO- http://localhost:4002/health` — expect HTTP 200.

`bun run smoke:health` runs all of the above and exits 0 if every probe passes (ships in P1.10).

## Project structure

```
fullstack-challenge/
├── .bun-version              # Bun 1.3.11 pin
├── docker-compose.yml        # Postgres, RabbitMQ, Keycloak, Kong, games, wallets
├── docker/                   # Container init artifacts (Postgres init script, Keycloak realm, Kong config)
├── packages/
│   ├── shared-kernel/        # Money VO, error taxonomy, event envelope, branded IDs, env schema
│   ├── contracts/            # Wire-format helpers (money snapshot); Phase 2+ adds event + DTO schemas
│   └── eslint-plugin/        # Custom @crash/no-number-for-money rule
├── services/
│   ├── games/                # NestJS service — round loop, bets, provably-fair (Phase 4+)
│   └── wallets/              # NestJS service — wallet + transaction aggregates (Phase 3+)
├── frontend/                 # Placeholder — TanStack Start app (Phase 7)
└── .planning/
    ├── PROJECT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md
    ├── adrs/                 # Architecture Decision Records
    ├── research/             # Stack + architecture + features + pitfalls + summary
    └── phases/               # Per-phase plans and research
```

## Architecture Decision Records

Every significant decision is captured in `.planning/adrs/`. See the [ADR catalogue](.planning/adrs/README.md) for the index. Phase 1 ships ADR-001 through ADR-006 covering ORM choice, Money representation, Bun pinning, configuration source-of-truth, the first-login wallet seed strategy, and the ESLint plugin location. Subsequent phases append ADR-007+ as decisions land — outbox topology, saga orchestration, WebSocket room granularity, the canvas renderer lifecycle, the leaderboard projection shape, and the observability stack.

## Roadmap

This is a ten-phase build. Phase 1 (Foundation & Infra) ships the bootstrap surface and shared kernel. Subsequent phases land the outbox/inbox spine, the wallet service, the game core with the provably-fair hash chain, end-to-end saga integration, the WebSocket gateway, the frontend vertical slice, the provably-fair UX and replay, auto features plus the leaderboard, and quality hardening with CI, observability, and full architecture documentation. See `.planning/ROADMAP.md` for the full plan and `.planning/REQUIREMENTS.md` for the requirement-to-phase traceability matrix.
