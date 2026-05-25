---
phase: 03-wallet-service
plan: 01
subsystem: messaging-spine
tags: [oi-1, oi-3, idempotent-subscribe, outbox-repository, decorator-patch, txEm, envelope-unwrap]
requires:
  - "@crash/messaging-spine v0.1.0 (Phase 2 deliverable)"
provides:
  - "Decorator unwraps wire envelope payload (handlers see envelope.payload directly)"
  - "Decorator passes txEm as third argument to wrapped handlers"
  - "OutboxRepository.add(env, route, em?) accepts an optional transactional EM"
affects:
  - "Public API of @IdempotentSubscribe — handlers MAY now accept a third txEm arg"
  - "Public API of OutboxRepository.add — third positional arg is additive and optional"
tech-stack:
  added: []
  patterns:
    - "Type-guarded wire envelope unwrap (`'payload' in rawPayload` narrow before peel)"
    - "EM injection per-call via optional positional arg (`(em ?? this.em).persist(row)`)"
key-files:
  created:
    - packages/messaging-spine/tests/unit/idempotent-subscribe.test.ts
  modified:
    - packages/messaging-spine/src/inbox/idempotent-subscribe.decorator.ts
    - packages/messaging-spine/src/outbox/outbox-repository.ts
    - packages/messaging-spine/tests/integration/outbox-write-and-publish.test.ts
    - packages/messaging-spine/tests/integration/inbox-dedup.test.ts
    - packages/messaging-spine/tests/integration/kill-9-recovery.test.ts
    - packages/messaging-spine/tests/integration/listen-notify-wake.test.ts
    - packages/messaging-spine/tests/integration/envelope-headers.test.ts
decisions:
  - "txEm is now part of the spine's public API surface — input for ADR-013 in Plan 03-10"
  - "OutboxRepository.add gains an optional third arg rather than a new method (additive, backwards-compatible)"
  - "envelope payload unwrap is type-guarded — flat payloads (no wrapping) fall through unchanged"
metrics:
  duration: "~25 minutes"
  completed: 2026-05-25
---

# Phase 3 Plan 01: messaging-spine OI follow-ups Summary

Surgical patch to `@crash/messaging-spine` closing Phase 2 carry-forwards OI-1 (envelope double-wrap), OI-3 (EM identity-map flush), and the related W3 outbox-bind-to-txEm gap, plus regression unit tests proving the fix targets real defects.

## What landed

- **Decorator unwrap (OI-1).** `idempotent-subscribe.decorator.ts` now derives a `wirePayload` from the AMQP body, peeling the inner `payload` field when the body itself is an envelope. Handlers read `envelope.payload.walletId` directly instead of walking `envelope.payload.payload.walletId`.
- **txEm propagation (OI-3).** `host.em.transactional(async (txEm) => ...)` forwards `txEm` to the wrapped handler as the third positional argument. Two-arg handlers ignore the extra arg by JS semantics — no breaking change.
- **OutboxRepository.add(em?) (W3).** Optional third positional argument lets Phase 3 handlers pass the decorator's `txEm` so the outbox row lands in the same TX as the inbox dedupe row and the side-effect mutation. Legacy callers (who already opened their own `em.transactional`) keep using the injected root EM by omitting the argument.

## Test evidence

| Suite | Pre-patch | Post-patch | Command |
|-------|-----------|------------|---------|
| Unit (5 files, 56 tests) | 56 pass | 56 pass | `bun test tests/unit` |
| Unit (idempotent-subscribe RED) | 3 fail / 2 pass | 5 pass | `bun test tests/unit/idempotent-subscribe.test.ts` |
| Unit (full, 6 files, 61 tests) | n/a | 61 pass | `bun test tests/unit` |
| Integration (6 files, 6 tests) | 6 pass (pre-existing) | 6 pass | `INTEGRATION=1 bun test tests/integration` |
| Typecheck | clean | clean | `bunx tsc --noEmit` |

Live `listen-notify-wake` median latency: **212.9 ms** (target < 250 ms).

## RED → GREEN gate compliance

- **RED commit:** `d0ebe44 test(messaging-spine): add OI-1 unwrap + OI-3 txEm propagation regressions` — 3 of 5 new tests fail against the unpatched decorator (proving they target real defects); the 2 that pass guard already-correct behaviour (`assertHostShape` + `CONSUMER_NAME_META` recording).
- **GREEN commit:** `ff110d5 fix(messaging-spine): unwrap nested envelope payload, propagate txEm to handler, accept optional em in OutboxRepository.add (OI-1 + OI-3 + W3)` — all 5 tests pass.
- **REFACTOR commit:** none needed — the patch was already minimal (10 net lines across two src files).

## Integration test edits (Y/N + counts)

**Y** — five of the six Phase 2 integration test probes were updated.

| File | Lines changed | Why |
|------|---------------|-----|
| `outbox-write-and-publish.test.ts` | 2 | type + body of `onProbe` peeled by one hop |
| `inbox-dedup.test.ts` | 2 | type + body of `onProbe` peeled by one hop |
| `kill-9-recovery.test.ts` | 2 | type + body of `onProbe` peeled by one hop (line 104, which serialises `envelope.payload` on the publisher side, is untouched — it was always one-hop) |
| `listen-notify-wake.test.ts` | 2 | type + body of `onProbe` peeled by one hop |
| `envelope-headers.test.ts` | 2 | type + body of `onProbe` peeled by one hop |
| `poison-message.test.ts` | 0 | the throwing handler does not read the payload |

Total: **5 files modified, 10 lines changed**.

## Public API change for ADR-013

`txEm: EntityManager` is now the **documented third argument** of every handler decorated with `@IdempotentSubscribe`. The doc-block on the decorator function records this contract (handlers MUST use `txEm` for entity persistence inside the TX; `host.em` is the root EM and will not flush deterministically inside this scope). Plan 03-10 should produce ADR-013 capturing this as the rationale for the public-API change.

## Deviations from Plan

None — plan executed exactly as written, including the W3 `OutboxRepository.add(em?)` extension added during the planning patch.

## Threat model spot-check

| Threat ID | Status | Evidence |
|-----------|--------|----------|
| T-03-01 (decorator unwrap tampering) | Mitigated | Type-narrowed (`typeof rawPayload === "object" && "payload" in rawPayload`) — flat payloads (no wrapping) fall through to `rawPayload` unchanged; arbitrary objects without a `payload` key cannot be coerced into a peel |
| T-03-02 (txEm leak) | Accepted | `txEm` lifecycle ends at the end of `em.transactional`'s callback inside the decorator — no reference escape path inside spine code |
| T-03-03 (integration tests on double-wrap shape) | Mitigated | All 5 probes that walked `envelope.payload.payload` were updated; integration suite re-run live 6/6 pass |
| T-03-SC (npm installs) | Mitigated | No new packages installed in this plan |

## Self-Check: PASSED

- `packages/messaging-spine/tests/unit/idempotent-subscribe.test.ts` — FOUND
- `packages/messaging-spine/src/inbox/idempotent-subscribe.decorator.ts` — FOUND (patched)
- `packages/messaging-spine/src/outbox/outbox-repository.ts` — FOUND (patched)
- Commit `d0ebe44` (RED) — FOUND in `git log`
- Commit `ff110d5` (GREEN) — FOUND in `git log`
- Commit `1eb453a` (integration updates) — FOUND in `git log`
- No `Co-Authored-By` / "Generated by" / emojis in any of the three commits — FOUND clean
- Only remaining `envelope.payload.payload` hit is the doc-block in `idempotent-subscribe.decorator.ts` documenting the OLD bug — FOUND (matches verification criterion)
