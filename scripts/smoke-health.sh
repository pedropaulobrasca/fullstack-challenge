#!/usr/bin/env bash
# smoke-health.sh — Phase 1 stack health probe runner.
# Prerequisite: `bun run docker:up` succeeded and all containers report healthy.
# Exit codes: 0 = every probe passed, 1 = at least one probe failed.

set -euo pipefail

PASS=0
FAIL=0

record_pass() {
  local name="$1"
  echo "[PASS] ${name}"
  PASS=$((PASS + 1))
}

record_fail() {
  local name="$1"
  local reason="$2"
  echo "[FAIL] ${name}: ${reason}"
  FAIL=$((FAIL + 1))
}

probe_postgres() {
  local name="postgres pg_isready"
  if docker compose exec -T postgres pg_isready -U admin >/dev/null 2>&1; then
    record_pass "${name}"
  else
    record_fail "${name}" "pg_isready exited non-zero"
  fi
}

probe_rabbitmq() {
  local name="rabbitmq management api"
  local code
  code=$(curl -s -u admin:admin -o /dev/null -w "%{http_code}" http://localhost:15672/api/overview || echo "000")
  if [[ "${code}" == "200" ]]; then
    record_pass "${name}"
  else
    record_fail "${name}" "expected HTTP 200, got ${code}"
  fi
}

probe_keycloak_health() {
  local name="keycloak /health/ready (port 9000)"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:9000/health/ready || echo "000")
  if [[ "${code}" == "200" ]]; then
    record_pass "${name}"
  else
    record_fail "${name}" "expected HTTP 200, got ${code}"
  fi
}

probe_keycloak_token() {
  local name="keycloak password grant (player/player123)"
  local body
  body=$(curl -s -X POST \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    -d 'grant_type=password&client_id=crash-game-client&username=player&password=player123' \
    http://localhost:8080/realms/crash-game/protocol/openid-connect/token || echo "")
  if command -v jq >/dev/null 2>&1; then
    if echo "${body}" | jq -er '.access_token | length > 0' >/dev/null 2>&1; then
      record_pass "${name}"
    else
      record_fail "${name}" "no access_token in response body"
    fi
  else
    if echo "${body}" | grep -q '"access_token":"[^"]'; then
      record_pass "${name}"
    else
      record_fail "${name}" "no access_token in response body"
    fi
  fi
}

probe_kong() {
  local name="kong admin /status (port 8001)"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8001/status || echo "000")
  if [[ "${code}" == "200" ]]; then
    record_pass "${name}"
  else
    record_fail "${name}" "expected HTTP 200, got ${code}"
  fi
}

probe_games_health() {
  local name="games /health (port 4001)"
  local body
  body=$(curl -sf http://localhost:4001/health || echo "")
  if [[ "${body}" == *'"status":"ok"'* && "${body}" == *'"service":"games"'* ]]; then
    record_pass "${name}"
  else
    record_fail "${name}" "unexpected body: ${body}"
  fi
}

probe_wallets_health() {
  local name="wallets /health (port 4002)"
  local body
  body=$(curl -sf http://localhost:4002/health || echo "")
  if [[ "${body}" == *'"status":"ok"'* && "${body}" == *'"service":"wallets"'* ]]; then
    record_pass "${name}"
  else
    record_fail "${name}" "unexpected body: ${body}"
  fi
}

probe_table_exists() {
  local label="$1"
  local db="$2"
  local table="$3"
  local name="postgres table ${db}.${table}"
  local result
  result=$(docker compose exec -T postgres psql -U admin -d "${db}" -tAc "SELECT to_regclass('public.${table}') IS NOT NULL" 2>/dev/null || echo "ERR")
  if [[ "${result}" == "t" ]]; then
    record_pass "${name}"
  else
    record_fail "${name}" "expected to_regclass to return t, got '${result}'"
  fi
}

probe_outbox_tables() {
  probe_table_exists "outbox" "games" "outbox"
  probe_table_exists "outbox" "wallets" "outbox"
}

probe_inbox_tables() {
  probe_table_exists "inbox" "games" "inbox"
  probe_table_exists "inbox" "wallets" "inbox"
}

probe_dead_letter_tables() {
  probe_table_exists "dead_letter_messages" "games" "dead_letter_messages"
  probe_table_exists "dead_letter_messages" "wallets" "dead_letter_messages"
}

probe_rabbitmq_object() {
  local kind="$1"
  local vhost_encoded="$2"
  local objname="$3"
  local name="rabbitmq ${kind} ${objname}"
  local code
  code=$(curl -s -u admin:admin -o /dev/null -w "%{http_code}" "http://localhost:15672/api/${kind}/${vhost_encoded}/${objname}" || echo "000")
  if [[ "${code}" == "200" ]]; then
    record_pass "${name}"
  else
    record_fail "${name}" "expected HTTP 200, got ${code}"
  fi
}

probe_rabbitmq_topology() {
  local vhost="%2F"
  probe_rabbitmq_object "exchanges" "${vhost}" "wallet.commands"
  probe_rabbitmq_object "exchanges" "${vhost}" "wallet.events"
  probe_rabbitmq_object "exchanges" "${vhost}" "wallet.dlx"
  probe_rabbitmq_object "exchanges" "${vhost}" "game.events"
  probe_rabbitmq_object "exchanges" "${vhost}" "game.dlx"
  probe_rabbitmq_object "queues" "${vhost}" "wallet.commands.q"
  probe_rabbitmq_object "queues" "${vhost}" "wallet.dlq"
  probe_rabbitmq_object "queues" "${vhost}" "games.wallet-events.q"
  probe_rabbitmq_object "queues" "${vhost}" "games.dlq"
}

echo "Running Phase 1+2 smoke probes against local stack..."
echo

probe_postgres
probe_rabbitmq
probe_keycloak_health
probe_keycloak_token
probe_kong
probe_games_health
probe_wallets_health
probe_outbox_tables
probe_inbox_tables
probe_dead_letter_tables
probe_rabbitmq_topology

TOTAL=$((PASS + FAIL))
echo
echo "Smoke summary: ${PASS}/${TOTAL} probes passed"

if [[ "${FAIL}" -eq 0 ]]; then
  exit 0
fi
exit 1
