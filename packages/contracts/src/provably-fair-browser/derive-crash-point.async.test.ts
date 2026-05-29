import { createHash, createHmac, randomBytes } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { deriveCrashPoint } from "../provably-fair/derive-crash-point";
import {
  deriveCrashPointAsync,
  deriveCrashPointWithHmacHex,
} from "./derive-crash-point.async";
import { sha256OfHexEncodedSeed } from "./sha256.async";

const LOCK_SERVER_SEED =
  "0000000000000000000000000000000000000000000000000000000000000001";

describe("deriveCrashPointAsync", () => {
  test("EXACT-BYTE LOCK: Phase 4 oracle (seed 0000...0001, client test, nonce 0n, bucket 101) returns 2.94", async () => {
    const value = await deriveCrashPointAsync({
      serverSeed: LOCK_SERVER_SEED,
      clientSeed: "test",
      nonce: 0n,
      instantCrashBucket: 101,
    });
    expect(value).toBe(2.94);
  });

  test("instant-crash bucket fires when intH % bucket === 0 returning exactly 1.00", async () => {
    const value = await deriveCrashPointAsync({
      serverSeed: LOCK_SERVER_SEED,
      clientSeed: "test",
      nonce: 160n,
      instantCrashBucket: 101,
    });
    expect(value).toBe(1.0);
  });

  test("cross-check: browser async result equals server sync deriveCrashPoint byte-for-byte across 25 nonces", async () => {
    for (let nonce = 0n; nonce < 25n; nonce++) {
      const sync = deriveCrashPoint({
        serverSeed: LOCK_SERVER_SEED,
        clientSeed: "alpha",
        nonce,
        instantCrashBucket: 101,
      });
      const asyncValue = await deriveCrashPointAsync({
        serverSeed: LOCK_SERVER_SEED,
        clientSeed: "alpha",
        nonce,
        instantCrashBucket: 101,
      });
      expect(asyncValue).toBe(sync);
    }
  });
});

describe("sha256OfHexEncodedSeed", () => {
  test("EXACT-BYTE LOCK: sha256OfHexEncodedSeed('00') equals the canonical Node digest", async () => {
    const digest = await sha256OfHexEncodedSeed("00");
    expect(digest).toBe(
      "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d",
    );
  });

  test("chain-proof determinism: arbitrary 64-char hex seed digest matches Node sha256 over hex-decoded bytes", async () => {
    const seed = randomBytes(32).toString("hex");
    const browserDigest = await sha256OfHexEncodedSeed(seed);
    const nodeDigest = createHash("sha256")
      .update(seed, "hex")
      .digest("hex");
    expect(browserDigest).toBe(nodeDigest);
  });
});

describe("deriveCrashPointWithHmacHex", () => {
  test("Phase 4 oracle returns {crashPoint:2.94, hmacHex, first13Hex} with the HMAC prefix matching the Node reference", async () => {
    const result = await deriveCrashPointWithHmacHex({
      serverSeed: LOCK_SERVER_SEED,
      clientSeed: "test",
      nonce: 0n,
      instantCrashBucket: 101,
    });

    expect(result.crashPoint).toBe(2.94);
    expect(result.hmacHex.length).toBe(64);
    expect(result.first13Hex).toBe(result.hmacHex.substring(0, 13));

    const referenceHmac = createHmac("sha256", LOCK_SERVER_SEED)
      .update("test:0")
      .digest("hex");
    expect(result.hmacHex).toBe(referenceHmac);
    expect(result.first13Hex).toBe(referenceHmac.substring(0, 13));
  });
});
