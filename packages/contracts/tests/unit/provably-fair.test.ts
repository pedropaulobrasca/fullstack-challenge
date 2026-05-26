import { createHash } from "node:crypto";
import { expect, test, describe } from "bun:test";
import {
  deriveCrashPoint,
  generateSeedChain,
  verifyCrashPoint,
  multiplierAt,
  crashTimeMs,
} from "../../src/provably-fair";

const LOCK_SERVER_SEED = "0000000000000000000000000000000000000000000000000000000000000001";

describe("deriveCrashPoint", () => {
  test("EXACT-BYTE LOCK: pinned tuple returns 2.94 across every Bun version", () => {
    const value = deriveCrashPoint({
      serverSeed: LOCK_SERVER_SEED,
      clientSeed: "test",
      nonce: 0n,
      instantCrashBucket: 101,
    });
    expect(value).toBe(2.94);
  });

  test("instant-crash bucket fires when intH % bucket === 0 returning exactly 1.00", () => {
    const value = deriveCrashPoint({
      serverSeed: LOCK_SERVER_SEED,
      clientSeed: "test",
      nonce: 160n,
      instantCrashBucket: 101,
    });
    expect(value).toBe(1.0);
  });

  test("result is always >= 1.00", () => {
    for (let nonce = 0n; nonce < 50n; nonce++) {
      const v = deriveCrashPoint({
        serverSeed: LOCK_SERVER_SEED,
        clientSeed: "alpha",
        nonce,
        instantCrashBucket: 101,
      });
      expect(v).toBeGreaterThanOrEqual(1.0);
    }
  });
});

describe("generateSeedChain", () => {
  test("returns length entries with chain integrity and per-entry hash commitment", () => {
    const terminalSeed =
      "abcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd";
    const chain = generateSeedChain(5n, terminalSeed);

    expect(chain).toHaveLength(5);
    expect(chain[4]!.seed).toBe(terminalSeed);

    for (let i = 0; i < chain.length; i++) {
      const entry = chain[i]!;
      expect(entry.hash).toBe(sha256OfHex(entry.seed));
    }

    for (let i = 1; i < chain.length; i++) {
      const prev = chain[i - 1]!;
      const curr = chain[i]!;
      expect(prev.seed).toBe(sha256OfHex(curr.seed));
    }
  });

  test("nonce indexes the chain position from 0 to length-1", () => {
    const chain = generateSeedChain(
      3n,
      "1111111111111111111111111111111111111111111111111111111111111111",
    );
    expect(chain[0]!.nonce).toBe(0n);
    expect(chain[1]!.nonce).toBe(1n);
    expect(chain[2]!.nonce).toBe(2n);
  });

  test("throws when length is not strictly positive", () => {
    expect(() => generateSeedChain(0n)).toThrow();
    expect(() => generateSeedChain(-1n)).toThrow();
  });

  test("omitting finalSeed produces a non-deterministic terminal seed", () => {
    const a = generateSeedChain(2n);
    const b = generateSeedChain(2n);
    expect(a[1]!.seed).not.toBe(b[1]!.seed);
  });
});

describe("verifyCrashPoint", () => {
  const input = {
    serverSeed: LOCK_SERVER_SEED,
    clientSeed: "test",
    nonce: 0n,
    instantCrashBucket: 101,
  };

  test("matches=true when expected equals recomputed", () => {
    const expected = deriveCrashPoint(input);
    const result = verifyCrashPoint(input, expected);
    expect(result.matches).toBe(true);
    expect(result.recomputed).toBe(expected);
  });

  test("matches=false for a perturbed expected value", () => {
    const expected = deriveCrashPoint(input);
    const result = verifyCrashPoint(input, expected + 0.01);
    expect(result.matches).toBe(false);
    expect(result.recomputed).toBe(expected);
  });
});

describe("multiplierAt", () => {
  test("elapsedMs=0 yields 1.0", () => {
    expect(multiplierAt(0, 0.06)).toBe(1.0);
  });

  test("elapsedMs=1000 yields exp(growthRate)", () => {
    expect(multiplierAt(1000, 0.06)).toBe(Math.exp(0.06));
  });

  test("throws on non-positive growthRate", () => {
    expect(() => multiplierAt(1000, 0)).toThrow();
    expect(() => multiplierAt(1000, -0.06)).toThrow();
  });
});

describe("crashTimeMs", () => {
  test("inverse of multiplierAt for known points", () => {
    const growthRate = 0.06;
    const crashPoint = 2.0;
    expect(crashTimeMs(growthRate, crashPoint)).toBe(
      Math.round((Math.log(crashPoint) / growthRate) * 1000),
    );
  });

  test("throws on crashPoint below 1.00", () => {
    expect(() => crashTimeMs(0.06, 0.5)).toThrow();
  });

  test("throws on non-positive growthRate", () => {
    expect(() => crashTimeMs(0, 2.0)).toThrow();
  });
});

function sha256OfHex(hexInput: string): string {
  return createHash("sha256").update(hexInput, "hex").digest("hex");
}
