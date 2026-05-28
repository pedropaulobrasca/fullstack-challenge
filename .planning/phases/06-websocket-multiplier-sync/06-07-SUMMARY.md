---
phase: 06-websocket-multiplier-sync
plan: 07
subsystem: kong-gateway
tags: [kong, websocket, gateway, routing]
requires:
  - 06-03
provides:
  - kong-ws-route
  - perimeter-ws-proxy
affects:
  - docker/kong/kong.yml
tech-stack:
  added: []
  patterns:
    - kong-declarative-config
    - pcre-anchored-route
key-files:
  created: []
  modified:
    - docker/kong/kong.yml
decisions:
  - "Kong 3.9 handles WS upgrade transparently via http/https protocols — no upgrade plugin needed"
  - "games-ws declared FIRST in games-service.routes[] to avoid PCRE shadowing by later patterns"
  - "Omit methods constraint — WS handshake is GET with Upgrade headers; constraining methods breaks the upgrade"
  - "Do not validate JWT at Kong — JwtIoAdapter at games:4001 owns auth (consistent with perimeter policy)"
metrics:
  duration: ~2min
  completed: 2026-05-27
  tasks: 1
  files: 1
requirements:
  - REQ-WS-01
---

# Phase 6 Plan 7: Kong games-ws Route Summary

Kong DB-less route `games-ws` proxies WS upgrade requests at `~/ws$` to games:4001, declared first under games-service to win PCRE matching over the six existing game routes.

## What changed

Inserted a single route block at the top of `services[games-service].routes[]` in `docker/kong/kong.yml`:

```yaml
- name: games-ws
  paths:
    - ~/ws$
  protocols:
    - http
    - https
  strip_path: false
```

The six existing routes (games-current, games-history, games-verify, games-bets-me, games-bet-place, games-bet-cashout) are preserved in their original order. The wallets-service block is untouched.

## Why this shape

- **PCRE ordering**: `~/ws$` is anchored and cannot collide with `~/games/*` or `~/wallets/*`, but Kong evaluates routes in declaration order on tie scoring. Placing `games-ws` first removes any latent ambiguity (RESEARCH §Pitfall 6).
- **No methods array**: a WebSocket handshake is `GET` with `Connection: Upgrade` and `Upgrade: websocket` headers. Adding `methods: [GET]` would still work for the handshake itself, but adding any non-GET method would break it — omitting the constraint keeps the route generic and removes a future footgun.
- **`strip_path: false`**: preserves `/ws` for the games-service Socket.IO mount point (matches the convention used by every other route in the file).
- **`protocols: [http, https]`**: Kong 3.9 detects the `Upgrade: websocket` header and switches the connection to WS over the matching transport. No `ws` / `wss` protocol entry needed (per Kong proxying docs).
- **No JWT plugin at Kong**: REQ-WS-01 mandates auth at the WS handshake, and Plan 06-03's JwtIoAdapter at io.use already enforces it. Adding a Kong-level JWT plugin would double-validate and complicate JWKS rotation. Perimeter policy = "services validate their own JWTs" (Phase 3).

## Verification

| Check | Result |
|-------|--------|
| `grep -c 'games-ws' docker/kong/kong.yml` | 1 |
| `grep -c '~/ws\$' docker/kong/kong.yml` | 1 |
| First route under games-service is `games-ws` | confirmed |
| Existing six game routes preserved unchanged | confirmed (diff +7 / -0) |
| wallets-service block unchanged | confirmed |

Live curl verification (Kong returns non-404 on `/ws` upgrade probe) is deferred to Plan 06-09 smoke probe 39, per the plan's success criteria.

## Deviations from Plan

None — plan executed exactly as written.

## Threat Mitigation

- **T-06-19 (Spoofing)**: Kong forwards WS upgrade unchanged; JwtIoAdapter (Plan 06-03) rejects unauthenticated connections at io.use. Mitigation in place.
- **T-06-20 (Route shadowing)**: `games-ws` is first in routes[] with anchored `~/ws$`. Verified by inspection; live smoke probe 39 will confirm in Plan 06-09.
- **T-06-21 (Token in Kong log)**: JwtIoAdapter pulls token from `auth.token` socket payload or `Authorization` header, never the query string. Kong access log will not contain the token.

## Self-Check: PASSED

- `docker/kong/kong.yml` exists and contains `games-ws` at the top of games-service.routes[]
- Commit `a0987d9` exists in git log
- One file modified, zero files deleted
- No AI fingerprints in commit message
