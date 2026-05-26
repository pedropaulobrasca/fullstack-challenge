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
  probe_rabbitmq_object "queues" "${vhost}" "wallet.debit.q"
  probe_rabbitmq_object "queues" "${vhost}" "wallet.credit.q"
  probe_rabbitmq_object "queues" "${vhost}" "wallet.dlq"
  probe_rabbitmq_object "queues" "${vhost}" "games.wallet-events.q"
  probe_rabbitmq_object "queues" "${vhost}" "games.dlq"
}

WALLETS_TOKEN=""

probe_wallets_keycloak_token() {
  local name="wallets keycloak password grant (player/player123)"
  local body
  body=$(curl -s -X POST \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    -d 'grant_type=password&client_id=crash-game-client&username=player&password=player123' \
    http://localhost:8080/realms/crash-game/protocol/openid-connect/token || echo "")
  if command -v jq >/dev/null 2>&1; then
    WALLETS_TOKEN=$(echo "${body}" | jq -r '.access_token // empty')
  else
    WALLETS_TOKEN=$(echo "${body}" | sed -nE 's/.*"access_token":"([^"]+)".*/\1/p')
  fi
  if [[ -n "${WALLETS_TOKEN}" && "${WALLETS_TOKEN}" != "null" ]]; then
    record_pass "${name}"
  else
    record_fail "${name}" "no access_token in response body"
  fi
}

probe_wallets_provision() {
  local name="wallets POST /wallets idempotent via Kong (port 8000)"
  if [[ -z "${WALLETS_TOKEN}" ]]; then
    record_fail "${name}" "no WALLETS_TOKEN (token grant must run first)"
    return
  fi
  local first_code
  first_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "Authorization: Bearer ${WALLETS_TOKEN}" \
    http://localhost:8000/wallets || echo "000")
  local second_code
  second_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "Authorization: Bearer ${WALLETS_TOKEN}" \
    http://localhost:8000/wallets || echo "000")
  if [[ ( "${first_code}" == "201" || "${first_code}" == "200" ) && "${second_code}" == "200" ]]; then
    record_pass "${name}"
  else
    record_fail "${name}" "expected first 201|200 and second 200, got first=${first_code} second=${second_code}"
  fi
}

probe_wallets_balance() {
  local name="wallets GET /wallets/me balance=INITIAL_BALANCE_CENTS via Kong"
  if [[ -z "${WALLETS_TOKEN}" ]]; then
    record_fail "${name}" "no WALLETS_TOKEN"
    return
  fi
  local body
  body=$(curl -s -H "Authorization: Bearer ${WALLETS_TOKEN}" http://localhost:8000/wallets/me || echo "")
  local amount=""
  if command -v jq >/dev/null 2>&1; then
    amount=$(echo "${body}" | jq -r '.balance.amount // empty')
  else
    amount=$(echo "${body}" | sed -nE 's/.*"amount":"([0-9]+)".*/\1/p' | head -n1)
  fi
  if [[ "${amount}" == "100000" ]]; then
    record_pass "${name}"
  else
    record_fail "${name}" "expected balance.amount=100000, got '${amount}'"
  fi
}

probe_wallets_kong_mutation_block() {
  local name="wallets POST /wallets/me/debit blocked at Kong (404)"
  if [[ -z "${WALLETS_TOKEN}" ]]; then
    record_fail "${name}" "no WALLETS_TOKEN"
    return
  fi
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "Authorization: Bearer ${WALLETS_TOKEN}" \
    http://localhost:8000/wallets/me/debit || echo "000")
  if [[ "${code}" == "404" ]]; then
    record_pass "${name}"
  else
    record_fail "${name}" "expected 404, got ${code}"
  fi
}

probe_games_rounds_current() {
  local name="27: GET /games/rounds/current returns 200 with seedHash"
  local response
  response=$(curl -s -w "\n%{http_code}" http://localhost:8000/games/rounds/current || echo $'\n000')
  local code="${response##*$'\n'}"
  local body="${response%$'\n'*}"
  if [[ "${code}" != "200" ]]; then
    record_fail "${name}" "expected 200, got ${code}"
    return
  fi
  if ! command -v jq >/dev/null 2>&1; then
    record_fail "${name}" "jq not available"
    return
  fi
  local status
  status=$(echo "${body}" | jq -r '.status // empty')
  if [[ "${status}" != "BETTING" && "${status}" != "RUNNING" && "${status}" != "CRASHED" && "${status}" != "SETTLED" ]]; then
    record_fail "${name}" "unexpected status '${status}'"
    return
  fi
  local seed_hash_length
  seed_hash_length=$(echo "${body}" | jq -r '.seedHash | length')
  if [[ "${seed_hash_length}" != "64" ]]; then
    record_fail "${name}" "expected seedHash length 64, got ${seed_hash_length}"
    return
  fi
  record_pass "${name} (status=${status})"
}

probe_games_rounds_history() {
  local name="28: GET /games/rounds/history?limit=5 returns 200 with rounds array"
  local response
  response=$(curl -s -w "\n%{http_code}" "http://localhost:8000/games/rounds/history?limit=5" || echo $'\n000')
  local code="${response##*$'\n'}"
  local body="${response%$'\n'*}"
  if [[ "${code}" != "200" ]]; then
    record_fail "${name}" "expected 200, got ${code}"
    return
  fi
  if ! command -v jq >/dev/null 2>&1; then
    record_fail "${name}" "jq not available"
    return
  fi
  if echo "${body}" | jq -e 'has("rounds") and (.rounds | type == "array")' >/dev/null 2>&1; then
    local count
    count=$(echo "${body}" | jq -r '.rounds | length')
    record_pass "${name} (rounds=${count})"
  else
    record_fail "${name}" "missing rounds array in body"
  fi
}

probe_games_bets_me_unauth() {
  local name="29: GET /games/bets/me without bearer returns 401 (JwtGuard)"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/games/bets/me || echo "000")
  if [[ "${code}" == "401" ]]; then
    record_pass "${name}"
  else
    record_fail "${name}" "expected 401, got ${code}"
  fi
}

probe_games_bets_me_auth() {
  local name="30: GET /games/bets/me with valid bearer returns 200 with bets array"
  if [[ -z "${WALLETS_TOKEN}" ]]; then
    record_fail "${name}" "no WALLETS_TOKEN (token grant must run first)"
    return
  fi
  local response
  response=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer ${WALLETS_TOKEN}" \
    http://localhost:8000/games/bets/me || echo $'\n000')
  local code="${response##*$'\n'}"
  local body="${response%$'\n'*}"
  if [[ "${code}" != "200" ]]; then
    record_fail "${name}" "expected 200, got ${code}"
    return
  fi
  if ! command -v jq >/dev/null 2>&1; then
    record_fail "${name}" "jq not available"
    return
  fi
  if echo "${body}" | jq -e 'has("bets") and (.bets | type == "array")' >/dev/null 2>&1; then
    local count
    count=$(echo "${body}" | jq -r '.bets | length')
    record_pass "${name} (bets=${count})"
  else
    record_fail "${name}" "missing bets array in body"
  fi
}

probe_games_seed_chain_initialized() {
  local name="31: postgres games.seed_chain populated after bootstrap"
  local count
  count=$(docker compose exec -T postgres psql -U admin -d games -tAc "SELECT COUNT(*) FROM seed_chain" 2>/dev/null | tr -d '[:space:]' || echo "ERR")
  if [[ "${count}" =~ ^[0-9]+$ ]] && [[ "${count}" -gt 0 ]]; then
    record_pass "${name} (rows=${count})"
  else
    record_fail "${name}" "expected COUNT > 0, got '${count}'"
  fi
}

probe_games_kong_mutation_block() {
  local name="32: POST /games/bet blocked at Kong (404 + no Route matched body)"
  local response
  response=$(curl -s -w "\n%{http_code}" -X POST http://localhost:8000/games/bet || echo $'\n000')
  local code="${response##*$'\n'}"
  local body="${response%$'\n'*}"
  if [[ "${code}" != "404" ]]; then
    record_fail "${name}" "expected 404, got ${code}"
    return
  fi
  if echo "${body}" | grep -q "no Route matched"; then
    record_pass "${name}"
  else
    record_fail "${name}" "404 status ok but body missing 'no Route matched': ${body}"
  fi
}

echo "Running Phase 1+2+3+4 smoke probes against local stack..."
echo

probe_postgres
probe_rabbitmq
probe_keycloak_health
probe_kong
probe_games_health
probe_wallets_health
probe_outbox_tables
probe_inbox_tables
probe_dead_letter_tables
probe_rabbitmq_topology
probe_wallets_keycloak_token
probe_wallets_provision
probe_wallets_balance
probe_wallets_kong_mutation_block
probe_games_rounds_current
probe_games_rounds_history
probe_games_bets_me_unauth
probe_games_bets_me_auth
probe_games_seed_chain_initialized
probe_games_kong_mutation_block

TOTAL=$((PASS + FAIL))
echo
echo "Smoke summary: ${PASS}/${TOTAL} probes passed"

if [[ "${FAIL}" -eq 0 ]]; then
  exit 0
fi
exit 1
