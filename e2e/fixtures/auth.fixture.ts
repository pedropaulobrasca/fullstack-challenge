import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { chromium, type FullConfig } from "@playwright/test";

export const STORAGE_STATE_PATH = join(__dirname, "../.auth/player.json");

const KEYCLOAK_AUTH_URL_PATTERN =
  /\/realms\/crash-game\/protocol\/openid-connect\/auth/;
const APP_ORIGIN = "http://localhost:3000";
const PLAYER_USERNAME = "player";
const PLAYER_PASSWORD = "player123";

export default async function globalSetup(_config: FullConfig): Promise<void> {
  await mkdir(dirname(STORAGE_STATE_PATH), { recursive: true });

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${APP_ORIGIN}/`);
    await page.waitForURL(KEYCLOAK_AUTH_URL_PATTERN, { timeout: 30_000 });

    await page.fill('input[name="username"]', PLAYER_USERNAME);
    await page.fill('input[name="password"]', PLAYER_PASSWORD);
    await page.click('input[type="submit"], button[type="submit"]');

    await page.waitForURL(`${APP_ORIGIN}/**`, { timeout: 30_000 });

    await context.storageState({ path: STORAGE_STATE_PATH });
  } finally {
    await browser.close();
  }
}
