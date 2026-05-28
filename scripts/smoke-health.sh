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
  local name="32: POST /games/bet at Kong reaches games-service (route opened in 05-08)"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8000/games/bet || echo "000")
  if [[ "${code}" == "401" ]]; then
    record_pass "${name} (JwtGuard rejects unauthenticated POST)"
  elif [[ "${code}" == "404" ]]; then
    record_fail "${name}" "Kong returned 404 — expected route games-bet-place to be open after 05-08"
  else
    record_fail "${name}" "expected 401 from JwtGuard, got ${code}"
  fi
}

wait_for_round_phase() {
  local desired="$1"
  local timeout_s="${2:-15}"
  local deadline=$(( $(date +%s) + timeout_s ))
  while [[ $(date +%s) -lt ${deadline} ]]; do
    local body
    body=$(curl -s http://localhost:8000/games/rounds/current || echo "")
    local status
    status=$(echo "${body}" | jq -r '.status // empty' 2>/dev/null || echo "")
    if [[ "${status}" == "${desired}" ]]; then
      return 0
    fi
    sleep 0.4
  done
  return 1
}

probe_games_bet_place_outside_betting() {
  local name="33: POST /games/bet during RUNNING returns 409 ROUND_NOT_IN_BETTING_PHASE"
  if [[ -z "${WALLETS_TOKEN}" ]]; then
    record_fail "${name}" "no WALLETS_TOKEN"
    return
  fi
  local attempt
  for attempt in 1 2 3; do
    if ! wait_for_round_phase "RUNNING" 15; then
      record_fail "${name}" "round never entered RUNNING within 15s (attempt ${attempt})"
      return
    fi
    local response
    response=$(curl -s -w "\n%{http_code}" -X POST \
      -H "Authorization: Bearer ${WALLETS_TOKEN}" \
      -H "Content-Type: application/json" \
      -d '{"amountCents":"10000"}' \
      http://localhost:8000/games/bet || echo $'\n000')
    local code="${response##*$'\n'}"
    local body="${response%$'\n'*}"
    if [[ "${code}" == "409" ]]; then
      local err_code
      err_code=$(echo "${body}" | jq -r '.code // .message.code // .error.code // empty' 2>/dev/null || echo "")
      if [[ "${err_code}" == "ROUND_NOT_IN_BETTING_PHASE" ]]; then
        record_pass "${name}"
        return
      fi
      record_fail "${name}" "expected code ROUND_NOT_IN_BETTING_PHASE, got '${err_code}' body=${body}"
      return
    fi
    if [[ "${code}" == "202" ]]; then
      sleep 1
      continue
    fi
    record_fail "${name}" "expected 409, got ${code} body=${body}"
    return
  done
  record_fail "${name}" "round phase kept flipping during 3 attempts"
}

GAMES_LAST_BET_ID=""
GAMES_LAST_BET_AMOUNT="10000"

probe_games_bet_place_happy() {
  local name="34: POST /games/bet during BETTING returns 202 PENDING + bet settles to ACTIVE"
  if [[ -z "${WALLETS_TOKEN}" ]]; then
    record_fail "${name}" "no WALLETS_TOKEN"
    return
  fi
  if ! wait_for_round_phase "BETTING" 20; then
    record_fail "${name}" "round never entered BETTING within 20s"
    return
  fi
  local response
  response=$(curl -s -w "\n%{http_code}" -X POST \
    -H "Authorization: Bearer ${WALLETS_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"amountCents\":\"${GAMES_LAST_BET_AMOUNT}\"}" \
    http://localhost:8000/games/bet || echo $'\n000')
  local code="${response##*$'\n'}"
  local body="${response%$'\n'*}"
  if [[ "${code}" != "202" ]]; then
    record_fail "${name}" "expected 202, got ${code} body=${body}"
    return
  fi
  local status
  status=$(echo "${body}" | jq -r '.status // empty' 2>/dev/null || echo "")
  local bet_id
  bet_id=$(echo "${body}" | jq -r '.betId // empty' 2>/dev/null || echo "")
  if [[ "${status}" != "PENDING" ]]; then
    record_fail "${name}" "expected status PENDING, got '${status}'"
    return
  fi
  if ! [[ "${bet_id}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
    record_fail "${name}" "expected betId uuid, got '${bet_id}'"
    return
  fi
  GAMES_LAST_BET_ID="${bet_id}"
  local deadline=$(( $(date +%s) + 10 ))
  local terminal=""
  while [[ $(date +%s) -lt ${deadline} ]]; do
    local bets_body
    bets_body=$(curl -s -H "Authorization: Bearer ${WALLETS_TOKEN}" http://localhost:8000/games/bets/me || echo "")
    terminal=$(echo "${bets_body}" | jq -r --arg id "${bet_id}" '.bets[] | select(.id == $id) | .status' 2>/dev/null | head -n1)
    if [[ "${terminal}" == "ACTIVE" || "${terminal}" == "REFUNDED" ]]; then
      record_pass "${name} (betId=${bet_id:0:8} status=${terminal})"
      return
    fi
    sleep 0.5
  done
  record_fail "${name}" "bet ${bet_id} never reached ACTIVE/REFUNDED within 10s (last='${terminal}')"
}

probe_games_balance_decreased_after_bet() {
  local name="35: wallet balance decreases by bet amount after settlement"
  if [[ -z "${WALLETS_TOKEN}" ]]; then
    record_fail "${name}" "no WALLETS_TOKEN"
    return
  fi
  if [[ -z "${GAMES_LAST_BET_ID}" ]]; then
    record_fail "${name}" "no GAMES_LAST_BET_ID (probe 34 must run first)"
    return
  fi
  local bets_body
  bets_body=$(curl -s -H "Authorization: Bearer ${WALLETS_TOKEN}" http://localhost:8000/games/bets/me || echo "")
  local bet_status
  bet_status=$(echo "${bets_body}" | jq -r --arg id "${GAMES_LAST_BET_ID}" '.bets[] | select(.id == $id) | .status' 2>/dev/null | head -n1)
  local body
  body=$(curl -s -H "Authorization: Bearer ${WALLETS_TOKEN}" http://localhost:8000/wallets/me || echo "")
  local amount
  amount=$(echo "${body}" | jq -r '.balance.amount // empty' 2>/dev/null || echo "")
  if ! [[ "${amount}" =~ ^[0-9]+$ ]]; then
    record_fail "${name}" "balance amount not numeric: '${amount}'"
    return
  fi
  if [[ "${bet_status}" == "ACTIVE" ]]; then
    if [[ "${amount}" -le 100000 && "${amount}" -lt 100000 ]]; then
      record_pass "${name} (balance=${amount} after ACTIVE bet of ${GAMES_LAST_BET_AMOUNT})"
    else
      record_fail "${name}" "expected balance < 100000 after ACTIVE bet, got ${amount}"
    fi
  elif [[ "${bet_status}" == "REFUNDED" ]]; then
    if [[ "${amount}" -ge 100000 ]]; then
      record_pass "${name} (balance=${amount} unchanged after REFUNDED bet)"
    else
      record_fail "${name}" "expected balance >= 100000 after REFUNDED bet, got ${amount}"
    fi
  else
    record_fail "${name}" "unexpected bet status '${bet_status}' (expected ACTIVE/REFUNDED)"
  fi
}

GAMES_LAST_CASHOUT_PAYOUT=""

probe_games_bet_cashout_during_running() {
  local name="36: POST /games/bet/cashout during RUNNING returns 200 + multiplier > 1"
  if [[ -z "${WALLETS_TOKEN}" ]]; then
    record_fail "${name}" "no WALLETS_TOKEN"
    return
  fi
  if [[ -z "${GAMES_LAST_BET_ID}" ]]; then
    record_fail "${name}" "no prior bet (probe 34 must succeed)"
    return
  fi
  local bets_body
  bets_body=$(curl -s -H "Authorization: Bearer ${WALLETS_TOKEN}" http://localhost:8000/games/bets/me || echo "")
  local current_status
  current_status=$(echo "${bets_body}" | jq -r --arg id "${GAMES_LAST_BET_ID}" '.bets[] | select(.id == $id) | .status' 2>/dev/null | head -n1)
  if [[ "${current_status}" != "ACTIVE" ]]; then
    record_fail "${name}" "bet ${GAMES_LAST_BET_ID:0:8} is '${current_status}', not ACTIVE — cannot cash out"
    return
  fi
  if ! wait_for_round_phase "RUNNING" 15; then
    record_fail "${name}" "round never entered RUNNING within 15s"
    return
  fi
  local response
  response=$(curl -s -w "\n%{http_code}" -X POST \
    -H "Authorization: Bearer ${WALLETS_TOKEN}" \
    http://localhost:8000/games/bet/cashout || echo $'\n000')
  local code="${response##*$'\n'}"
  local body="${response%$'\n'*}"
  if [[ "${code}" != "200" ]]; then
    record_fail "${name}" "expected 200, got ${code} body=${body}"
    return
  fi
  local mult
  mult=$(echo "${body}" | jq -r '.multiplier // empty' 2>/dev/null || echo "")
  local payout_amount
  payout_amount=$(echo "${body}" | jq -r '.payoutCents.amount // empty' 2>/dev/null || echo "")
  local payout_scale
  payout_scale=$(echo "${body}" | jq -r '.payoutCents.scale // empty' 2>/dev/null || echo "")
  if ! awk -v m="${mult}" 'BEGIN { exit !(m+0 > 1.0) }'; then
    record_fail "${name}" "expected multiplier > 1.0, got '${mult}'"
    return
  fi
  if ! [[ "${payout_amount}" =~ ^[0-9]+$ ]]; then
    record_fail "${name}" "payoutCents.amount not bigint string: '${payout_amount}'"
    return
  fi
  if [[ "${payout_scale}" != "2" ]]; then
    record_fail "${name}" "expected payoutCents.scale=2, got '${payout_scale}'"
    return
  fi
  GAMES_LAST_CASHOUT_PAYOUT="${payout_amount}"
  record_pass "${name} (multiplier=${mult} payout=${payout_amount})"
}

probe_games_balance_credited_after_cashout() {
  local name="37: wallet balance credited by payoutCents after cashout"
  if [[ -z "${WALLETS_TOKEN}" ]]; then
    record_fail "${name}" "no WALLETS_TOKEN"
    return
  fi
  if [[ -z "${GAMES_LAST_CASHOUT_PAYOUT}" ]]; then
    record_fail "${name}" "no prior cashout payout (probe 36 must succeed)"
    return
  fi
  local deadline=$(( $(date +%s) + 8 ))
  local final_amount=""
  while [[ $(date +%s) -lt ${deadline} ]]; do
    local body
    body=$(curl -s -H "Authorization: Bearer ${WALLETS_TOKEN}" http://localhost:8000/wallets/me || echo "")
    final_amount=$(echo "${body}" | jq -r '.balance.amount // empty' 2>/dev/null || echo "")
    if [[ "${final_amount}" =~ ^[0-9]+$ ]]; then
      local expected_min=$(( 100000 - GAMES_LAST_BET_AMOUNT + GAMES_LAST_CASHOUT_PAYOUT ))
      if [[ "${final_amount}" -ge "${expected_min}" ]]; then
        record_pass "${name} (balance=${final_amount} >= ${expected_min})"
        return
      fi
    fi
    sleep 0.4
  done
  record_fail "${name}" "balance never reached expected credit within 8s (last='${final_amount}')"
}

probe_games_bet_cashout_without_active() {
  local name="38: POST /games/bet/cashout without ACTIVE bet returns 409"
  if [[ -z "${WALLETS_TOKEN}" ]]; then
    record_fail "${name}" "no WALLETS_TOKEN"
    return
  fi
  local deadline=$(( $(date +%s) + 25 ))
  while [[ $(date +%s) -lt ${deadline} ]]; do
    local bets_body
    bets_body=$(curl -s -H "Authorization: Bearer ${WALLETS_TOKEN}" http://localhost:8000/games/bets/me || echo "")
    local has_active
    has_active=$(echo "${bets_body}" | jq -r '[.bets[] | select(.status == "ACTIVE")] | length' 2>/dev/null || echo "1")
    if [[ "${has_active}" == "0" ]]; then
      break
    fi
    sleep 0.5
  done
  local response
  response=$(curl -s -w "\n%{http_code}" -X POST \
    -H "Authorization: Bearer ${WALLETS_TOKEN}" \
    http://localhost:8000/games/bet/cashout || echo $'\n000')
  local code="${response##*$'\n'}"
  local body="${response%$'\n'*}"
  if [[ "${code}" != "409" ]]; then
    record_fail "${name}" "expected 409, got ${code} body=${body}"
    return
  fi
  local err_code
  err_code=$(echo "${body}" | jq -r '.code // .message.code // .error.code // empty' 2>/dev/null || echo "")
  case "${err_code}" in
    NO_ACTIVE_BET|BET_NOT_CASHABLE|ROUND_NOT_RUNNING)
      record_pass "${name} (code=${err_code})"
      ;;
    *)
      record_fail "${name}" "expected code in {NO_ACTIVE_BET,BET_NOT_CASHABLE,ROUND_NOT_RUNNING}, got '${err_code}' body=${body}"
      ;;
  esac
}

probe_games_ws_kong_upgrade_route() {
  local name="39: GET /ws via Kong with Upgrade header reaches games (not Kong 404)"
  local response
  response=$(curl -s -i \
    -H "Connection: Upgrade" \
    -H "Upgrade: websocket" \
    http://localhost:8000/ws 2>/dev/null || echo "CURL_FAIL")
  local code
  code=$(echo "${response}" | sed -nE 's/^HTTP\/[0-9.]+ ([0-9]+).*/\1/p' | head -n1)
  if echo "${response}" | grep -qi "no Route matched"; then
    record_fail "${name}" "Kong-origin 404 'no Route matched' — games-ws route is shadowed or missing"
    return
  fi
  case "${code}" in
    400|401|426|101|200|404)
      if [[ "${code}" == "404" ]]; then
        if echo "${response}" | grep -qi "no Route matched"; then
          record_fail "${name}" "Kong 404 no Route matched"
        else
          record_pass "${name} (games-origin 404, route forwarded)"
        fi
      else
        record_pass "${name} (HTTP ${code} from games engine)"
      fi
      ;;
    *)
      record_fail "${name}" "unexpected status '${code}' body=$(echo "${response}" | tail -n3)"
      ;;
  esac
}

probe_games_ws_handshake_denied() {
  local name="40: WS handshake without token returns connect_error UNAUTHORIZED"
  local output
  output=$(cd services/games && bun -e '
    import { io } from "socket.io-client";
    const s = io("http://localhost:8000/", { path: "/ws", transports: ["websocket"], reconnection: false });
    s.on("connect_error", (e) => { console.log("CONNECT_ERROR " + e.message); s.close(); process.exit(0); });
    s.on("connect", () => { console.log("UNEXPECTED_CONNECT"); s.close(); process.exit(1); });
    setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 5000);
  ' 2>&1 || echo "RUN_FAIL")
  if echo "${output}" | grep -q "CONNECT_ERROR.*UNAUTHORIZED"; then
    record_pass "${name}"
  else
    record_fail "${name}" "expected CONNECT_ERROR UNAUTHORIZED, got: ${output}"
  fi
}

probe_games_ws_snapshot_on_connect() {
  local name="41: WS handshake with token receives round:snapshot within 5s"
  if [[ -z "${WALLETS_TOKEN}" ]]; then
    record_fail "${name}" "no WALLETS_TOKEN"
    return
  fi
  local output
  output=$(cd services/games && WALLETS_TOKEN="${WALLETS_TOKEN}" bun -e '
    import { io } from "socket.io-client";
    const s = io("http://localhost:8000/", { path: "/ws", auth: { token: process.env.WALLETS_TOKEN }, transports: ["websocket"], reconnection: false });
    s.on("connect_error", (e) => { console.log("CONNECT_ERROR " + e.message); process.exit(1); });
    s.on("round:snapshot", (p) => {
      const hasRound = p && Object.prototype.hasOwnProperty.call(p, "round");
      const hasServerTime = p && Object.prototype.hasOwnProperty.call(p, "serverTime");
      console.log("SNAPSHOT round=" + hasRound + " serverTime=" + hasServerTime);
      s.close();
      process.exit(0);
    });
    setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 5000);
  ' 2>&1 || echo "RUN_FAIL")
  if echo "${output}" | grep -q "SNAPSHOT round=true serverTime=true"; then
    record_pass "${name}"
  elif echo "${output}" | grep -q "SNAPSHOT"; then
    record_fail "${name}" "snapshot missing round/serverTime key: ${output}"
  else
    record_fail "${name}" "expected round:snapshot, got: ${output}"
  fi
}

probe_games_ws_tick_frequency() {
  local name="42: WS observes >= 30 round:tick during 2s RUNNING window"
  if [[ -z "${WALLETS_TOKEN}" ]]; then
    record_fail "${name}" "no WALLETS_TOKEN"
    return
  fi
  if ! wait_for_round_phase "RUNNING" 15; then
    record_fail "${name}" "round never entered RUNNING within 15s"
    return
  fi
  local output
  output=$(cd services/games && WALLETS_TOKEN="${WALLETS_TOKEN}" bun -e '
    import { io } from "socket.io-client";
    const s = io("http://localhost:8000/", { path: "/ws", auth: { token: process.env.WALLETS_TOKEN }, transports: ["websocket"], reconnection: false });
    let ticks = 0;
    let counting = false;
    s.on("connect_error", (e) => { console.log("CONNECT_ERROR " + e.message); process.exit(1); });
    s.on("round:tick", () => { if (counting) ticks++; });
    s.on("connect", () => {
      counting = true;
      setTimeout(() => { console.log("TICKS " + ticks); s.close(); process.exit(0); }, 2000);
    });
    setTimeout(() => { console.log("TIMEOUT ticks=" + ticks); process.exit(1); }, 8000);
  ' 2>&1 || echo "RUN_FAIL")
  local count
  count=$(echo "${output}" | sed -nE 's/^TICKS ([0-9]+).*/\1/p' | head -n1)
  if [[ "${count}" =~ ^[0-9]+$ ]] && [[ "${count}" -ge 30 ]]; then
    record_pass "${name} (ticks=${count})"
  else
    record_fail "${name}" "expected >= 30 ticks in 2s, got '${count}' output=${output}"
  fi
}

probe_games_ws_lifecycle_sequence() {
  local name="43: WS observes round:started/running/crashed/settled within 30s"
  if [[ -z "${WALLETS_TOKEN}" ]]; then
    record_fail "${name}" "no WALLETS_TOKEN"
    return
  fi
  local output
  output=$(cd services/games && WALLETS_TOKEN="${WALLETS_TOKEN}" bun -e '
    import { io } from "socket.io-client";
    const s = io("http://localhost:8000/", { path: "/ws", auth: { token: process.env.WALLETS_TOKEN }, transports: ["websocket"], reconnection: false });
    const seen = new Set();
    const want = ["round:started", "round:running", "round:crashed", "round:settled"];
    s.on("connect_error", (e) => { console.log("CONNECT_ERROR " + e.message); process.exit(1); });
    for (const ev of want) {
      s.on(ev, () => {
        seen.add(ev);
        if (want.every((w) => seen.has(w))) {
          console.log("LIFECYCLE_OK " + want.join(","));
          s.close();
          process.exit(0);
        }
      });
    }
    setTimeout(() => { console.log("TIMEOUT seen=" + [...seen].join(",")); process.exit(1); }, 30000);
  ' 2>&1 || echo "RUN_FAIL")
  if echo "${output}" | grep -q "LIFECYCLE_OK"; then
    record_pass "${name}"
  else
    record_fail "${name}" "expected all four lifecycle events, got: ${output}"
  fi
}

probe_games_bet_ws_my_active() {
  local name="44: REST bet during BETTING surfaces bet:my_active over WS within 5s"
  if [[ -z "${WALLETS_TOKEN}" ]]; then
    record_fail "${name}" "no WALLETS_TOKEN"
    return
  fi
  if ! wait_for_round_phase "BETTING" 20; then
    record_fail "${name}" "round never entered BETTING within 20s"
    return
  fi
  local output
  output=$(cd services/games && WALLETS_TOKEN="${WALLETS_TOKEN}" bun -e '
    import { io } from "socket.io-client";
    const token = process.env.WALLETS_TOKEN;
    const s = io("http://localhost:8000/", { path: "/ws", auth: { token }, transports: ["websocket"], reconnection: false });
    s.on("connect_error", (e) => { console.log("CONNECT_ERROR " + e.message); process.exit(1); });
    s.on("bet:my_active", (p) => {
      const id = p && (p.betId || p.id) ? (p.betId || p.id) : "";
      console.log("BET_MY_ACTIVE " + id);
      s.close();
      process.exit(0);
    });
    s.on("connect", async () => {
      try {
        const res = await fetch("http://localhost:8000/games/bet", {
          method: "POST",
          headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify({ amountCents: "10000" }),
        });
        const body = await res.json().catch(() => ({}));
        console.log("BET_POST " + res.status + " " + (body.betId || ""));
        if (res.status !== 202) { console.log("BET_REJECTED"); process.exit(1); }
      } catch (e) {
        console.log("BET_POST_FAIL " + (e && e.message ? e.message : String(e)));
        process.exit(1);
      }
    });
    setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 12000);
  ' 2>&1 || echo "RUN_FAIL")
  if echo "${output}" | grep -q "BET_MY_ACTIVE"; then
    record_pass "${name} ($(echo "${output}" | grep BET_MY_ACTIVE | head -n1))"
  else
    record_fail "${name}" "expected bet:my_active event, got: ${output}"
  fi
}

echo "Running Phase 1+2+3+4+5+6 smoke probes against local stack..."
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
probe_games_bet_place_outside_betting
probe_games_bet_place_happy
probe_games_balance_decreased_after_bet
probe_games_bet_cashout_during_running
probe_games_balance_credited_after_cashout
probe_games_bet_cashout_without_active
probe_games_ws_kong_upgrade_route
probe_games_ws_handshake_denied
probe_games_ws_snapshot_on_connect
probe_games_ws_tick_frequency
probe_games_ws_lifecycle_sequence
probe_games_bet_ws_my_active

TOTAL=$((PASS + FAIL))
echo
echo "Smoke summary: ${PASS}/${TOTAL} probes passed"

if [[ "${FAIL}" -eq 0 ]]; then
  exit 0
fi
exit 1
