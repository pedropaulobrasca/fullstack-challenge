import { describe, expect, it } from "vitest";
import { buildConfig, configSchema, parseConfig } from "./config";

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

describe("config schema", () => {
  it("coerces numeric env strings into numbers", () => {
    const parsed = configSchema.parse(validEnv);
    expect(parsed.VITE_GROWTH_RATE).toBe(0.06);
    expect(typeof parsed.VITE_GROWTH_RATE).toBe("number");
    expect(parsed.VITE_BET_MIN_CENTS).toBe(100);
    expect(typeof parsed.VITE_BET_MAX_CENTS).toBe("number");
    expect(parsed.VITE_EWMA_ALPHA).toBe(0.1);
  });

  it("rejects a non-positive growth rate (multiplierAt throws if <= 0)", () => {
    expect(() => configSchema.parse({ ...validEnv, VITE_GROWTH_RATE: "0" })).toThrow();
    expect(() => configSchema.parse({ ...validEnv, VITE_GROWTH_RATE: "-0.5" })).toThrow();
  });

  it("rejects an EWMA alpha outside [0, 1]", () => {
    expect(() => configSchema.parse({ ...validEnv, VITE_EWMA_ALPHA: "1.5" })).toThrow();
  });

  it("rejects a malformed issuer url", () => {
    expect(() => configSchema.parse({ ...validEnv, VITE_KEYCLOAK_ISSUER: "not-a-url" })).toThrow();
  });

  it("rejects missing required keys", () => {
    const { VITE_WS_URL: _omitted, ...withoutWs } = validEnv;
    expect(() => configSchema.parse(withoutWs)).toThrow();
  });
});

describe("buildConfig", () => {
  it("maps parsed env into a frozen typed config", () => {
    const cfg = parseConfig(validEnv);
    expect(cfg.keycloak.clientId).toBe("crash-game-client");
    expect(cfg.history.redMaxX).toBe(1.5);
    expect(cfg.bet.maxCents).toBe(100000);
    expect(cfg.currencyCode).toBe("CRD");
    expect(Object.isFrozen(cfg)).toBe(true);
    expect(Object.isFrozen(cfg.bet)).toBe(true);
  });

  it("buildConfig accepts an already-parsed object", () => {
    const cfg = buildConfig(configSchema.parse(validEnv));
    expect(cfg.growthRate).toBe(0.06);
  });
});

describe("replay / drawer / fairness sections", () => {
  it("parses VITE_REPLAY_SPEEDS into a numeric array", () => {
    const cfg = parseConfig(validEnv);
    expect(cfg.replay.speeds).toEqual([1, 2, 4]);
  });

  it("parses VITE_REPLAY_AUTOSTART into a boolean true", () => {
    const cfg = parseConfig(validEnv);
    expect(cfg.replay.autostart).toBe(true);
  });

  it("parses VITE_DRAWER_SLIDE_MS into a positive integer", () => {
    const cfg = parseConfig(validEnv);
    expect(cfg.drawer.slideMs).toBe(220);
  });

  it("exposes the default instant-crash bucket on fairness", () => {
    const cfg = parseConfig(validEnv);
    expect(cfg.fairness.instantCrashBucket).toBe(101);
  });

  it("honors an explicit VITE_INSTANT_CRASH_BUCKET override", () => {
    const cfg = parseConfig({ ...validEnv, VITE_INSTANT_CRASH_BUCKET: "77" });
    expect(cfg.fairness.instantCrashBucket).toBe(77);
  });

  it("rejects malformed VITE_REPLAY_SPEEDS at parse time", () => {
    expect(() =>
      parseConfig({ ...validEnv, VITE_REPLAY_SPEEDS: "1,abc,4" }),
    ).toThrow();
  });

  it("rejects a VITE_REPLAY_SPEEDS list missing 1", () => {
    expect(() =>
      parseConfig({ ...validEnv, VITE_REPLAY_SPEEDS: "2,4" }),
    ).toThrow(/must include 1/i);
  });

  it("applies defaults when replay/drawer/fairness env vars are absent", () => {
    const {
      VITE_REPLAY_SPEEDS: _s,
      VITE_REPLAY_AUTOSTART: _a,
      VITE_DRAWER_SLIDE_MS: _d,
      VITE_INSTANT_CRASH_BUCKET: _b,
      ...withoutOptionals
    } = validEnv;
    const cfg = parseConfig(withoutOptionals);
    expect(cfg.replay.speeds).toEqual([1, 2, 4]);
    expect(cfg.replay.autostart).toBe(true);
    expect(cfg.drawer.slideMs).toBe(220);
    expect(cfg.fairness.instantCrashBucket).toBe(101);
  });

  it("freezes the speeds array so consumers cannot mutate it", () => {
    const cfg = parseConfig(validEnv);
    expect(Object.isFrozen(cfg.replay)).toBe(true);
    expect(Object.isFrozen(cfg.replay.speeds)).toBe(true);
    expect(Object.isFrozen(cfg.drawer)).toBe(true);
    expect(Object.isFrozen(cfg.fairness)).toBe(true);
  });
});
