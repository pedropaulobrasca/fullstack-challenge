# Phase 04 — Deferred Items

Items intentionally postponed to later phases. Logged here so they are not lost.

- [ ] Phase 10: extract JwtGuard from services/{wallets,games}/src/presentation/guards/jwt.guard.ts into packages/auth-kernel — current duplication is deliberate per Research Open Q3 and ADR-012 carry-forward (service-boundary independence).
- [ ] services/games/tests/unit/money-rounding-sanity.test.ts — Money.multiplyRounded API missing on shared-kernel Money VO; pre-existing failing test belongs to Plan 04-01 wave-0 scope (provably-fair + REQ-DOM-07 rounding). Out of scope for 04-02; flagged for the 04-01 executor.
