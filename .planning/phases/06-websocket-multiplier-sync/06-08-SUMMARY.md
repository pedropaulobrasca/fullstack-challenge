---
phase: 06-websocket-multiplier-sync
plan: 08
completed: 2026-05-28T00:00:00Z
status: complete
typecheck: clean (tsconfig.integration.json)
note: live execution gated to 06-09 smoke checkpoint
---

# 06-08 — WebSocket Integration + Cashout Race Property Tests

## Result

- `bunx tsc --noEmit -p tsconfig.integration.json` → clean.
- 5 integration test files + 1 ws-client helper + 1 cashout-race property test authored.
- Live execution deferred to 06-09 smoke checkpoint (requires `bun run docker:up`).

## Files

| Path | Coverage |
|------|----------|
| `tests/integration/_helpers/ws-client.ts` | socket.io-client wrapper: `connect(token)`, `waitForEvent(name)`, `close()` |
| `tests/integration/ws-handshake-jwt.test.ts` | no token → rejected; garbage token → rejected; valid token → accepted + socket.data.playerId set (REQ-WS-01) |
| `tests/integration/ws-rooms.test.ts` | joins lobby + user:{id}; events route to correct room (REQ-WS-02) |
| `tests/integration/ws-snapshot.test.ts` | snapshot on connect; reconnect re-emits; **multi-tab parity** (two sockets, same token, byte-equal snapshots — W3 plan-check fix) (REQ-WS-04, REQ-WS-07) |
| `tests/integration/ws-event-catalog.test.ts` | full round sequence: round:started → running → tick(s) → crashed → settled (REQ-WS-03) |
| `tests/integration/ws-tick-volatile.test.ts` | ~30Hz tick frequency within tolerance (REQ-WS-06) |
| `tests/property/cashout-race.property.test.ts` | fast-check 50 runs, ±50ms dt around crash time; invariant: exactly ONE of {valid payout ts<crash, 409 conflict}, NEVER double-cashout or post-crash payout (REQ-WS-05) |

## Commits

- `5055965` test(06-08): add ws-client helper + handshake/rooms/snapshot integration tests
- `8437f1c` test(06-08): add ws event catalog + volatile tick integration tests
- (this commit) test(06-08): add cashout-race property test

## REQ coverage

REQ-WS-01 (handshake JWT), REQ-WS-02 (rooms), REQ-WS-03 (event catalog), REQ-WS-04 (snapshot), REQ-WS-05 (cashout race), REQ-WS-06 (volatile tick), REQ-WS-07 (reconnect snapshot) — all have a dedicated test file.

## Deferred

Live test execution (`INTEGRATION=1 bun test tests/integration` + property test) runs in 06-09 smoke checkpoint against live docker stack.

## Next

06-09 smoke probes 39-44 + blocking live walkthrough checkpoint.
