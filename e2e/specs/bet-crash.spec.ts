import { expect, test } from "@playwright/test";
import { STORAGE_STATE_PATH } from "../fixtures/auth.fixture";

test.use({ storageState: STORAGE_STATE_PATH });

const BETTING_WAIT_TIMEOUT_MS = 120_000;
const CRASH_WAIT_TIMEOUT_MS = 180_000;
const OUTCOME_WAIT_TIMEOUT_MS = 30_000;

async function waitForRoundStatus(
  page: import("@playwright/test").Page,
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
  page: import("@playwright/test").Page,
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

test("login -> bet -> wait crash -> bet lost", async ({ page }) => {
  test.setTimeout(300_000);

  await page.goto("/");
  await expect(page.getByTestId("connection-badge")).toHaveAttribute(
    "data-status",
    "live",
    { timeout: 30_000 },
  );

  const outcomeBefore = await page
    .getByTestId("game-root")
    .getAttribute("data-last-bet-outcome");

  await waitForFreshBettingWindow(page, 2_500, BETTING_WAIT_TIMEOUT_MS);

  const amountInput = page.getByTestId("bet-amount-input");
  const placeButton = page.getByTestId("bet-place-button");
  await expect(placeButton).toHaveText(/place bet/i, { timeout: 60_000 });
  await amountInput.fill("5.00");
  await expect(placeButton).toBeEnabled({ timeout: 10_000 });

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
    `place-bet failed with ${betResponse.status()}: ${await betResponse.text().catch(() => "")}`,
  ).toBeLessThan(300);

  await waitForRoundStatus(page, "CRASHED", CRASH_WAIT_TIMEOUT_MS);

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

  expect(outcomeValue, `expected LOST outcome, observed "${outcomeValue}"`).toBe(
    "LOST",
  );
});
