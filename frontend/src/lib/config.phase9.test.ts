import { describe, expect, it } from "vitest";
import { parseConfig } from "./config";

const validEnv = {
  VITE_KEYCLOAK_ISSUER: "http://localhost:8080/realms/crash-game",
  VITE_KEYCLOAK_CLIENT_ID: "crash-game-client",
  VITE_WS_URL: "http://localhost:8000",
  VITE_REST_BASE: "http://localhost:8000",
  VITE_GROWTH_RATE: "0.06",
  VITE_EWMA_ALPHA: "0.1",
  VITE_HISTORY_RED_MAX_X: "1.5",
  VITE_HISTORY_YELLOW_MAX_X: "2.0",
  VITE_BET_MIN_CENTS: "100",
  VITE_BET_MAX_CENTS: "100000",
  VITE_CURRENCY_CODE: "CRD",
  VITE_FEED_BUFFER_SIZE: "50",
  VITE_HISTORY_SIZE: "20",
  VITE_REPLAY_SPEEDS: "1,2,4",
  VITE_REPLAY_AUTOSTART: "true",
  VITE_DRAWER_SLIDE_MS: "220",
  VITE_INSTANT_CRASH_BUCKET: "101",
};

describe("Phase 9 — autoBet + leaderboard config namespaces", () => {
  it("parses all 6 phase 9 keys when present", () => {
    const cfg = parseConfig({
      ...validEnv,
      VITE_AUTO_BET_MIN_TARGET: "1.5",
      VITE_AUTO_BET_MAX_TARGET: "50",
      VITE_LEADERBOARD_SIZE: "5",
      VITE_LEADERBOARD_WINDOW_HOURS: "12",
      VITE_LEADERBOARD_RELATIVE_REFRESH_MS: "10000",
      VITE_RANK_UP_TRANSITION_MS: "150",
    });
    expect(cfg.autoBet.minTarget).toBe(1.5);
    expect(cfg.autoBet.maxTarget).toBe(50);
    expect(cfg.leaderboard.sizeN).toBe(5);
    expect(cfg.leaderboard.windowHours).toBe(12);
    expect(cfg.leaderboard.relativeRefreshMs).toBe(10000);
    expect(cfg.leaderboard.rankUpTransitionMs).toBe(150);
  });

  it("applies UI-SPEC defaults when phase 9 keys are absent", () => {
    const cfg = parseConfig(validEnv);
    expect(cfg.autoBet.minTarget).toBe(1.01);
    expect(cfg.autoBet.maxTarget).toBe(100);
    expect(cfg.leaderboard.sizeN).toBe(10);
    expect(cfg.leaderboard.windowHours).toBe(24);
    expect(cfg.leaderboard.relativeRefreshMs).toBe(5000);
    expect(cfg.leaderboard.rankUpTransitionMs).toBe(200);
  });

  it("rejects VITE_AUTO_BET_MIN_TARGET of 1.00 (1.00x is unreachable)", () => {
    expect(() =>
      parseConfig({ ...validEnv, VITE_AUTO_BET_MIN_TARGET: "1.00" }),
    ).toThrow();
  });

  it("rejects VITE_LEADERBOARD_SIZE of zero", () => {
    expect(() =>
      parseConfig({ ...validEnv, VITE_LEADERBOARD_SIZE: "0" }),
    ).toThrow();
  });

  it("rejects a negative VITE_LEADERBOARD_RELATIVE_REFRESH_MS", () => {
    expect(() =>
      parseConfig({ ...validEnv, VITE_LEADERBOARD_RELATIVE_REFRESH_MS: "-1" }),
    ).toThrow();
  });

  it("freezes the autoBet and leaderboard namespaces", () => {
    const cfg = parseConfig(validEnv);
    expect(Object.isFrozen(cfg.autoBet)).toBe(true);
    expect(Object.isFrozen(cfg.leaderboard)).toBe(true);
  });
});
