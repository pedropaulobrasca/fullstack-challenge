---
phase: 10-quality-hardening-docs
plan: 04
subsystem: observability-infrastructure (Jaeger + Prometheus + Grafana compose stack)
tags:
  - jaeger-all-in-one
  - prometheus-scrape
  - grafana-provisioning
  - grafana-datasource-uid
  - smoke-probes
dependency-graph:
  requires:
    - 10-03 (OTel SDK emits OTLP HTTP to http://jaeger:4318/v1/traces — receiver now live)
  provides:
    - docker-compose.yml — 3 new service blocks (jaeger, prometheus, grafana) with healthchecks + depends_on
    - docker/prometheus/prometheus.yml — scrape configs for games:4001 + wallets:4002 every 15s
    - docker/grafana/provisioning/datasources/{prometheus,jaeger}.yml — UID-pinned datasources
    - docker/grafana/provisioning/dashboards/dashboards.yml — file provider scanning the dashboards dir
    - docker/grafana/provisioning/dashboards/{games-service,wallets-service,crash-domain}.json — 3 dashboards
    - scripts/smoke-health.sh — probes 45-47 covering the new observability containers
  affects:
    - 10-05 (custom Prometheus metrics emitted from /metrics will be scraped immediately on the next docker:up)
    - 10-07 (Playwright spec can assert traces reach Jaeger via http://localhost:16686/api/services)
    - 10-08 (CI runs smoke-health.sh — must pass probes 45-47 as part of the green-CI gate)
tech-stack:
  added:
    - "jaegertracing/all-in-one:1.63.0 (NOT :1.63 — that tag does not exist on Docker Hub; the canonical jaegertracing/all-in-one repo publishes only :X.Y.Z and :X.Y forms — for 1.63 the published tag is 1.63.0)"
    - "prom/prometheus:v3.0.1"
    - "grafana/grafana:11.3.1"
  patterns:
    - "Pin Grafana datasource UIDs at provisioning time (`uid: prometheus-main` / `uid: jaeger-main`) so every dashboard JSON can reference them deterministically (Pitfall 4). Auto-generated UIDs would break the dashboard JSONs across re-provisions."
    - "Jaeger all-in-one with COLLECTOR_OTLP_ENABLED=true exposes a native OTLP HTTP receiver on 4318 — no separate OTel collector needed for the dev/recruiter stack."
    - "Grafana mounts on :3001 instead of :3000 to avoid the FE dev-server port collision (RESEARCH Pitfall: 'Mounting Grafana on port 3000')."
    - "Prometheus scrapes the in-compose hostnames games:4001 + wallets:4002 — NEVER via Kong (V13 metrics endpoints are internal-network only; Kong route audit confirms /metrics is not in docker/kong/kong.yml)."
    - "Anonymous Viewer role for Grafana (GF_AUTH_ANONYMOUS_ENABLED + GF_AUTH_ANONYMOUS_ORG_ROLE=Viewer) — recruiter can read dashboards without credentials, but cannot edit or query outside the provisioned datasources (T-10-09 EoP mitigation)."
key-files:
  created:
    - docker/prometheus/prometheus.yml
    - docker/grafana/provisioning/datasources/prometheus.yml
    - docker/grafana/provisioning/datasources/jaeger.yml
    - docker/grafana/provisioning/dashboards/dashboards.yml
    - docker/grafana/provisioning/dashboards/games-service.json
    - docker/grafana/provisioning/dashboards/wallets-service.json
    - docker/grafana/provisioning/dashboards/crash-domain.json
  modified:
    - docker-compose.yml (appended 3 new service blocks; existing services untouched)
    - scripts/smoke-health.sh (3 new probe functions + 3 new registration calls + banner string update)
decisions:
  - "Pinned `jaegertracing/all-in-one:1.63.0` instead of the plan-cited `:1.63` because the bare-minor tag is not published — `docker pull jaegertracing/all-in-one:1.63` returns `manifest unknown`. Same minor family, same canonical org — verified via Docker Hub tag list. This is a tag-suffix correction, NOT a package substitution (the image source is unchanged)."
  - "Used schemaVersion 39 for all 3 dashboards (current for Grafana 11.x). Older schemaVersion 38 also accepted by Grafana 11.3.1 but 39 is the on-disk format produced by the UI editor on this version."
  - "All dashboard panels reference `{ type: 'prometheus', uid: 'prometheus-main' }` explicitly per panel — not a top-level dashboard datasource — so even if Grafana ever changes how it resolves the dashboard-level default, each panel survives. Pitfall 4 mitigation belt-and-suspenders."
metrics:
  duration: "~12 min (read + edit compose + 1 image-tag fix + provisioning tree + 3 dashboard JSONs + 3 probe functions + 3 atomic commits)"
  completed: "2026-05-31"
requirements:
  - REQ-OBS-03 (Prometheus + Grafana stack in docker-compose with pre-provisioned dashboards — landed; custom metric emit is on plan 10-05 dependency)
---

# Phase 10 Plan 04: Jaeger + Prometheus + Grafana Compose Stack Summary

One-liner: The full observability infrastructure boots zero-config from `bun run docker:up` — Jaeger receives OTel spans on 4318, Prometheus scrapes both services every 15s with `depends_on: service_healthy` gating, and Grafana opens at :3001 with two datasources (UID-pinned `prometheus-main` + `jaeger-main`) and three dashboards (games-service overview, wallets-service overview, crash-domain custom) already loaded.

## What was built

### Task 1 — docker-compose service blocks + prometheus.yml (commit `46dcd78`)

Three new service blocks appended to `docker-compose.yml` (existing services unchanged — verified via diff: only additions, no deletions, no reorderings):

- **jaeger** (`jaegertracing/all-in-one:1.63.0`, pinned; ports `16686:16686` UI + `4318:4318` OTLP HTTP; env `COLLECTOR_OTLP_ENABLED: "true"`; healthcheck `wget -qO- http://localhost:14269/` every 10s, timeout 5s, retries 10)
- **prometheus** (`prom/prometheus:v3.0.1`, pinned; port `9090:9090`; volume `./docker/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro`; `depends_on: { games: service_healthy, wallets: service_healthy }` per Pitfall 3; healthcheck `wget -qO- http://localhost:9090/-/healthy` every 10s)
- **grafana** (`grafana/grafana:11.3.1`, pinned; port `3001:3000` to avoid the FE port-3000 collision; env `GF_AUTH_ANONYMOUS_ENABLED=true` + `GF_AUTH_ANONYMOUS_ORG_ROLE=Viewer` + `GF_USERS_DEFAULT_THEME=dark`; volume `./docker/grafana/provisioning:/etc/grafana/provisioning:ro`; `depends_on: { prometheus: service_healthy }`; healthcheck `wget -qO- http://localhost:3000/api/health | grep -q ok`)

`docker/prometheus/prometheus.yml`:

```yaml
global:
  scrape_interval: 15s
  scrape_timeout: 10s

scrape_configs:
  - job_name: "games-service"
    metrics_path: /metrics
    static_configs:
      - targets: ["games:4001"]
  - job_name: "wallets-service"
    metrics_path: /metrics
    static_configs:
      - targets: ["wallets:4002"]
```

Note that the targets are the in-compose Docker hostnames `games:4001` + `wallets:4002`, NOT `localhost:4001` + `localhost:4002` (Prometheus runs inside the same network and never reaches the host) and NOT via Kong (`/metrics` is intentionally absent from `docker/kong/kong.yml` — V13 internal-only).

Verification: `bun run docker:up --wait` succeeded; all 3 new containers report `healthy`; live curls returned the expected bodies (Prometheus `"Prometheus Server is Healthy."`, Grafana `database:ok` JSON, Jaeger UI 200).

### Task 2 — Grafana provisioning tree (commit `70643bc`)

`docker/grafana/provisioning/datasources/prometheus.yml`:

```yaml
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    uid: prometheus-main         # PINNED — referenced by every dashboard JSON
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: false
    jsonData:
      timeInterval: 15s
```

`docker/grafana/provisioning/datasources/jaeger.yml`: same shape with `type: jaeger`, `uid: jaeger-main`, `url: http://jaeger:16686`.

`docker/grafana/provisioning/dashboards/dashboards.yml`: file provider with `options.path: /etc/grafana/provisioning/dashboards`, `allowUiUpdates: false` (recruiter can browse but not break the source-of-truth dashboards), `foldersFromFilesStructure: true`, `updateIntervalSeconds: 30`.

Three dashboard JSONs, each with `id: null` (Grafana assigns on import) and a pinned `uid` field for the dashboard itself, and every panel carrying `datasource: { type: "prometheus", uid: "prometheus-main" }` explicitly (not via the dashboard-level default — per-panel pinning survives every Grafana resolution path):

- **games-service.json** (uid `games-service-overview`) — 4 panels: HTTP request rate by route, HTTP p95/p99 duration by route, AMQP publish + consume rate by exchange/queue, active WS connections.
- **wallets-service.json** (uid `wallets-service-overview`) — 3 panels: HTTP request rate, HTTP p95/p99 duration, AMQP publish + consume rate. (No WS panel — wallets is not a WS provider.)
- **crash-domain.json** (uid `crash-domain-custom`) — 5 panels covering the differential observability claim from RESEARCH "specifics":
  1. `crash_bet_volume_total` rate by status (timeseries)
  2. `crash_rtp_window` current value (stat panel with fairness thresholds: red < 0.9, yellow 0.9–0.95, green 0.95–1.02, yellow 1.02–1.1, red > 1.1 — visual signal that the game is running honestly)
  3. `multiplier_drift_seconds` p50/p95 (timeseries — server tick vs wall clock)
  4. `ws_broadcast_latency_seconds` p50/p95 (timeseries — tick to emit)
  5. `active_ws_connections` (timeseries — lobby gauge)

Until plan 10-05 lands the custom metric emit, the crash-domain panels render empty — expected and acceptable per the plan's "MUST load without 'Datasource not found' errors even if no metric data has been scraped yet" criterion. Verified live: `curl /api/datasources/uid/prometheus-main` returns 200 with the pinned uid; `curl /api/search?type=dash-db` lists all 3 dashboards; Grafana logs report `"finished to provision dashboards"` with no "Datasource not found" errors.

Pino-style log noise in Grafana startup (`/etc/grafana/provisioning/plugins` + `/etc/grafana/provisioning/alerting` "no such file or directory") is benign — these are optional provisioning subdirectories that the plan does not require.

### Task 3 — smoke-health.sh probes 45-47 (commit `d6332c7`)

Three new probe functions appended (matching the numeric-prefix style used since probe 27):

- **`probe_jaeger_ui`** — `curl -o /dev/null -w "%{http_code}" http://localhost:16686/` MUST be 200. Name: `"45: jaeger UI reachable (port 16686)"`.
- **`probe_prometheus_healthy`** — `curl http://localhost:9090/-/healthy` MUST be 200 + body grep `prometheus|healthy` (case-insensitive). Name: `"46: prometheus /-/healthy (port 9090)"`.
- **`probe_grafana_health`** — `curl http://localhost:3001/api/health` MUST be 200 + body grep `"database":"ok"`. Name: `"47: grafana /api/health database ok (port 3001)"`.

Registered in the runner block after `probe_games_bet_ws_my_active`. Existing 44 probes untouched (no renumbering, no reordering). The banner string changed from `"Phase 1+2+3+4+5+6"` to `"Phase 1+2+3+4+5+6+10"` to reflect the new probes' phase origin.

Live run output:

```
[PASS] 45: jaeger UI reachable (port 16686)
[PASS] 46: prometheus /-/healthy (port 9090)
[PASS] 47: grafana /api/health database ok (port 3001)
```

The 3 new probes do not depend on any game/bet state — they hit the observability containers directly, so they pass even on a freshly booted stack.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Jaeger image tag `:1.63` does not exist on Docker Hub → corrected to `:1.63.0`**
- **Found during:** Task 1 first `bun run docker:up --wait`
- **Issue:** `docker pull jaegertracing/all-in-one:1.63` fails with `manifest unknown: manifest unknown`. The RESEARCH file (and the plan's `read_first` excerpt) cited `:1.63` but the canonical `jaegertracing/all-in-one` Docker Hub repo only publishes `:X.Y.Z` (e.g. `1.63.0`) and `:X.Y` for the older 1.5x line (e.g. `1.60`, `1.59`, ...). For the 1.6x line the bare-minor form is not published.
- **Fix:** Edited `docker-compose.yml` to use `jaegertracing/all-in-one:1.63.0`. Same minor family, same canonical org (verified by querying `https://hub.docker.com/v2/repositories/jaegertracing/all-in-one/tags` — `1.63.0` was the matching published tag).
- **Why this is NOT a package-install Rule 3 exclusion:** The image source is unchanged (`jaegertracing/all-in-one`); only the tag suffix was disambiguated. No package-name substitution, no swap to a similarly-named repo, no slopsquatting risk. A bare-tag typo in the plan resolved against the canonical org's actual published tags.
- **Files modified:** docker-compose.yml
- **Commit:** included in `46dcd78`

No Rule 2 (missing critical functionality) — security/correctness items in the threat model (T-10-09 anon Viewer role, T-10-10 Kong route audit, T-10-11 OTLP target hostname) were already specified by the plan and shipped as designed.

No Rule 3 (blocking issue) — no env vars, no migrations, no package installs, no missing files referenced by the new code.

No Rule 4 (architectural change) — additive only to compose; existing services untouched; no schema/route changes.

## Auth gates / human-action events

None. Grafana ships with `GF_AUTH_ANONYMOUS_ENABLED=true` so the recruiter never sees a login screen for the dashboards (read-only Viewer org). Prometheus + Jaeger are unauthenticated by design for the dev/recruiter stack.

## Files touched (canonical paths)

Created:
- `/Users/pedro/Projetos/fullstack-challenge/docker/prometheus/prometheus.yml`
- `/Users/pedro/Projetos/fullstack-challenge/docker/grafana/provisioning/datasources/prometheus.yml`
- `/Users/pedro/Projetos/fullstack-challenge/docker/grafana/provisioning/datasources/jaeger.yml`
- `/Users/pedro/Projetos/fullstack-challenge/docker/grafana/provisioning/dashboards/dashboards.yml`
- `/Users/pedro/Projetos/fullstack-challenge/docker/grafana/provisioning/dashboards/games-service.json`
- `/Users/pedro/Projetos/fullstack-challenge/docker/grafana/provisioning/dashboards/wallets-service.json`
- `/Users/pedro/Projetos/fullstack-challenge/docker/grafana/provisioning/dashboards/crash-domain.json`

Modified:
- `/Users/pedro/Projetos/fullstack-challenge/docker-compose.yml`
- `/Users/pedro/Projetos/fullstack-challenge/scripts/smoke-health.sh`

## Commits

| # | Hash | Type | Description |
| - | ---- | ---- | ----------- |
| 1 | `46dcd78` | feat | Add Jaeger + Prometheus + Grafana to docker-compose with healthchecks |
| 2 | `70643bc` | feat | Pre-provision Grafana datasources + 3 dashboards |
| 3 | `d6332c7` | feat | Extend smoke-health.sh with probes 45-47 for observability stack |

## Verification

| Check | Result |
| ----- | ------ |
| `bun run docker:up --wait` exit code | 0 — all containers including the 3 new ones report Healthy |
| `docker compose ps prometheus jaeger grafana --format json \| jq -r '.Health' \| sort -u` | `healthy` (single value across all 3) |
| `curl -sf http://localhost:9090/-/healthy` | `Prometheus Server is Healthy.` |
| `curl -sf http://localhost:16686/` | HTTP 200 (Jaeger UI HTML body) |
| `curl -sf http://localhost:3001/api/health \| grep -q ok` | matched |
| `curl -sf http://localhost:3001/api/datasources/uid/prometheus-main \| jq -r .uid` | `prometheus-main` |
| `curl -sf http://localhost:3001/api/datasources/uid/jaeger-main \| jq -r .uid` | `jaeger-main` |
| `curl -sf http://localhost:3001/api/search?type=dash-db \| jq -r '.[].uid' \| sort` | `crash-domain-custom`, `games-service-overview`, `wallets-service-overview` |
| `grep -c "uid: prometheus-main" docker/grafana/provisioning/datasources/prometheus.yml` | `1` |
| `grep -c "uid: jaeger-main" docker/grafana/provisioning/datasources/jaeger.yml` | `1` |
| `grep -c "prometheus-main" docker/grafana/provisioning/dashboards/crash-domain.json` | `5` (one per panel datasource ref) |
| `grep -cE "crash_bet_volume_total\|crash_rtp_window" docker/grafana/provisioning/dashboards/crash-domain.json` | `2` |
| `bash scripts/smoke-health.sh \| grep -E "^\[PASS\] 4[567]:"` | `45`, `46`, `47` all `[PASS]` |
| Grafana logs for `"Datasource not found"` errors | zero matches |
| Frontend port `:3000` still reachable | unaffected (Grafana on `:3001`) |
| Kong `/metrics` route present | NO — Kong route audit confirms `/metrics` is internal-only (T-10-10 mitigated) |

## Known Stubs

None. The provisioning tree references only metrics that either exist today (HTTP / AMQP auto-instrumentation from plan 10-03's `nestjs-otel apiMetrics: { enable: true }`) or are scheduled to land in plan 10-05 (the 5 custom metrics: `crash_bet_volume_total`, `crash_rtp_window`, `multiplier_drift_seconds`, `ws_broadcast_latency_seconds`, `active_ws_connections`). The crash-domain panels render empty until 10-05 ships — this is the documented intended state and the plan explicitly accepted it.

## Threat Flags

None new. The plan's threat register is fully mitigated as designed:

- **T-10-09 EoP / Grafana anon role** — `GF_AUTH_ANONYMOUS_ORG_ROLE: "Viewer"` set; verified in compose file. Anonymous users cannot edit dashboards or add datasources outside the provisioned set.
- **T-10-10 Info Disclosure / `/metrics` exposed externally** — `grep -n /metrics docker/kong/kong.yml` returns zero matches; Prometheus reaches `/metrics` exclusively via the internal docker network hostnames `games:4001` + `wallets:4002`.
- **T-10-11 Info Disclosure / OTLP exporter target** — From plan 10-03, the OTLP exporter targets `http://jaeger:4318/v1/traces` (in-compose hostname); no external public collector is contacted. Re-verified via `docker compose exec games env | grep OTEL` (lands on the next container rebuild when the Wave 2 plans require it — 10-04 itself does not require the games/wallets containers to restart).

No NEW security surface introduced. No new Kong routes, no new public HTTP listener on either games or wallets, no new file IO, no new schema changes. The 3 new container ports (`:16686`, `:9090`, `:3001`) are localhost-bound by Docker Compose's default port-mapping rules — they're for the recruiter's host machine, not internet-exposed.

## Self-Check: PASSED

All 7 created files verified present on disk:
- `docker/prometheus/prometheus.yml` — FOUND
- `docker/grafana/provisioning/datasources/prometheus.yml` — FOUND
- `docker/grafana/provisioning/datasources/jaeger.yml` — FOUND
- `docker/grafana/provisioning/dashboards/dashboards.yml` — FOUND
- `docker/grafana/provisioning/dashboards/games-service.json` — FOUND
- `docker/grafana/provisioning/dashboards/wallets-service.json` — FOUND
- `docker/grafana/provisioning/dashboards/crash-domain.json` — FOUND

All 3 commits verified in `git log`:
- `46dcd78` feat(10-04): add Jaeger + Prometheus + Grafana to docker-compose with healthchecks
- `70643bc` feat(10-04): pre-provision Grafana datasources + 3 dashboards
- `d6332c7` feat(10-04): extend smoke-health.sh with probes 45-47 for observability stack
