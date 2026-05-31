/**
 * REQ-TEST-05(a) — happy-path cashout spec scaffold.
 *
 * Body lands in Phase 10 plan 10-07 (Wave 3). Until then this file ships as a
 * skipped test so the scaffold is verifiable end-to-end (config + fixture +
 * spec discovery) without asserting on game state that requires the Wave 1/2
 * observability + polish fixes to be live.
 */
import { test } from "@playwright/test";

test.skip(
  "player flow: login -> BETTING -> bet -> RUNNING -> cashout -> balance updated [Wave 3 plan 10-07]",
  async ({ page: _page }) => {
    // Implemented in plan 10-07. The storageState fixture (e2e/fixtures/auth.fixture.ts)
    // pre-authenticates the player; the body will:
    //   1. Goto baseURL, wait for data-status="BETTING".
    //   2. Place a bet via the BetPanel and assert PENDING -> ACTIVE WS state.
    //   3. Wait for data-status="RUNNING" then click cashout.
    //   4. Assert wallet balance ticks up by amount * multiplier (Money VO).
  },
);
