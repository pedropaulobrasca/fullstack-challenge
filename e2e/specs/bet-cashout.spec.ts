import { expect, test, type Page } from "@playwright/test";
import { STORAGE_STATE_PATH } from "../fixtures/auth.fixture";

test.use({ storageState: STORAGE_STATE_PATH });

const BETTING_WAIT_TIMEOUT_MS = 120_000;
const RUNNING_WAIT_TIMEOUT_MS = 30_000;
const OUTCOME_WAIT_TIMEOUT_MS = 30_000;
const CASHOUT_VISIBLE_TIMEOUT_MS = 15_000;
const MAX_INSTANT_CRASH_RETRIES = 5;

async function waitForRoundStatus(
  page: Page,
  status: "BETTING" | "RUNNING" | "CRASHED" | "SETTLED",
  timeoutMs: number,
): Promise<void> {
  await page.waitForFunction(
    (expected) =>
      document
        .querySelector('[data-testid="game-root"]')
        ?.getAttribute("data-round-status") === expected,
    status,
    { timeout: timeoutMs },
  );
}

async function waitForFreshBettingWindow(
  page: Page,
  minRemainingMs: number,
  totalTimeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + totalTimeoutMs;
  while (Date.now() < deadline) {
    await waitForRoundStatus(page, "BETTING", deadline - Date.now());
    const remaining = await page.evaluate(async () => {
      const response = await fetch("http://localhost:8000/games/rounds/current");
      if (!response.ok) return -1;
      const body = (await response.json()) as { bettingEndsAt: string | null };
      if (body.bettingEndsAt === null) return -1;
      return new Date(body.bettingEndsAt).getTime() - Date.now();
    });
    if (remaining >= minRemainingMs) {
      return;
    }
    await waitForRoundStatus(
      page,
      "RUNNING",
      Math.max(1, deadline - Date.now()),
    ).catch(() => undefined);
  }
  throw new Error(
    `timed out waiting for BETTING window with at least ${minRemainingMs}ms remaining`,
  );
}

async function loadGameAndWaitForLive(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("connection-badge")).toHaveAttribute(
    "data-status",
    "live",
    { timeout: 30_000 },
  );
  const placeButton = page.getByTestId("bet-place-button");
  await expect(placeButton).toHaveText(/place bet/i, { timeout: 60_000 });
}

type CashoutAttemptResult =
  | { status: "cashed-out" }
  | { status: "instant-crash" };

async function attemptCashoutCycle(page: Page): Promise<CashoutAttemptResult> {
  const outcomeBefore = await page
    .getByTestId("game-root")
    .getAttribute("data-last-bet-outcome");

  await waitForFreshBettingWindow(page, 3_500, BETTING_WAIT_TIMEOUT_MS);

  const amountInput = page.getByTestId("bet-amount-input");
  const placeButton = page.getByTestId("bet-place-button");
  await amountInput.fill("5.00");
  await expect(placeButton).toBeEnabled({ timeout: 5_000 });

  const betResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/games/bet") &&
      response.request().method() === "POST",
    { timeout: 10_000 },
  );
  await placeButton.click();
  const betResponse = await betResponsePromise;
  expect(
    betResponse.status(),
    `place-bet failed with ${betResponse.status()}: ${await betResponse
      .text()
      .catch(() => "")}`,
  ).toBeLessThan(300);

  await waitForRoundStatus(page, "RUNNING", RUNNING_WAIT_TIMEOUT_MS);

  const cashoutButton = page.getByTestId("cashout-button");
  const raceResult = await Promise.race([
    cashoutButton
      .waitFor({ state: "visible", timeout: CASHOUT_VISIBLE_TIMEOUT_MS })
      .then(() => "visible" as const)
      .catch(() => "no-cashout-button" as const),
    waitForRoundStatus(page, "CRASHED", CASHOUT_VISIBLE_TIMEOUT_MS)
      .then(() => "crashed" as const)
      .catch(() => "no-crash" as const),
  ]);

  if (raceResult !== "visible") {
    return { status: "instant-crash" };
  }

  await cashoutButton.click();

  const outcomeHandle = await page.waitForFunction(
    (prev) => {
      const value = document
        .querySelector('[data-testid="game-root"]')
        ?.getAttribute("data-last-bet-outcome");
      if (value === null || value === undefined) return null;
      if (value === prev) return null;
      return value;
    },
    outcomeBefore,
    { timeout: OUTCOME_WAIT_TIMEOUT_MS },
  );
  const outcomeValue = (await outcomeHandle.jsonValue()) as string;

  expect(
    outcomeValue,
    `expected CASHED_OUT outcome, observed "${outcomeValue}"`,
  ).toBe("CASHED_OUT");

  return { status: "cashed-out" };
}

test("login -> BETTING -> bet -> RUNNING -> cashout -> balance updated", async ({
  page,
}) => {
  test.setTimeout(360_000);

  await loadGameAndWaitForLive(page);

  const startBalance = (
    await page.getByTestId("balance-pill").innerText()
  ).trim();
  expect(startBalance.length).toBeGreaterThan(0);

  let attempt = 0;
  while (attempt < MAX_INSTANT_CRASH_RETRIES) {
    attempt += 1;
    const result = await attemptCashoutCycle(page);
    if (result.status === "cashed-out") {
      break;
    }
    if (attempt >= MAX_INSTANT_CRASH_RETRIES) {
      throw new Error(
        `cashout-button never appeared during RUNNING after ${MAX_INSTANT_CRASH_RETRIES} attempts`,
      );
    }
    await page.reload();
    await loadGameAndWaitForLive(page);
  }

  await expect(page.getByTestId("game-root")).toHaveAttribute(
    "data-last-bet-outcome",
    "CASHED_OUT",
  );

  await expect
    .poll(
      async () => (await page.getByTestId("balance-pill").innerText()).trim(),
      { timeout: 15_000 },
    )
    .not.toBe(startBalance);
});
