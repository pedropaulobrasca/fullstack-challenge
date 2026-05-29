# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## ws-round-lifecycle-not-emitted — WS round:running/crashed/settled never reach lobby
- **Date:** 2026-05-29
- **Error patterns:** toISOString is not a function, startedAt, crashedAt, settledAt, round:running, round:crashed, round:settled, round loop step failed, transitionToRunning, RETURNING, raw SQL, MikroORM, Bun pg driver, timestamptz string not Date
- **Root cause:** The three Round FSM-transition repo methods (transitionFromBettingToRunning/RunningToCrashed/CrashedToSettled) rehydrate the aggregate from raw SQL `RETURNING *` rows via `em.getConnection().execute()`. Unlike the ORM `findOne` path, raw execute() does not hydrate `timestamptz` columns into Date under Bun's pg driver — they come back as strings. RoundLoopService builds the ROUND_RUNNING/CRASHED/SETTLED eventEmitter payloads with `.toISOString()` on startedAt/crashedAt/settledAt, which throws before emit() runs, so the gateway @OnEvent never fires and clients never receive those events. (round:started works because its round is ORM-hydrated; round:tick flows because multiplierBroadcast.start() runs on the line before the throwing emit.)
- **Fix:** Added a `toDate(value: Date|string|null): Date|null` helper to MikroRoundRepository and used it for all timestamp columns in `mapDbRowToAggregate`; widened RoundDbRow timestamp fields to `Date|string|null`.
- **Files changed:** services/games/src/infrastructure/repositories/mikro-round.repository.ts
---
