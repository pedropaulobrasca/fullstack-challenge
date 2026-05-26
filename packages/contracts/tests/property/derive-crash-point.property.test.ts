import { createHmac } from "node:crypto";
import { expect, test } from "bun:test";
import fc from "fast-check";
import {
  deriveCrashPoint,
  HEX_CHARS,
  TWO_POW_52,
} from "../../src/provably-fair";

const hex64 = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((bytes) => Buffer.from(bytes).toString("hex"));

const clientSeedArb = fc.string({ minLength: 1, maxLength: 64 });

const nonceArb = fc
  .bigInt({ min: 0n, max: BigInt(Number.MAX_SAFE_INTEGER) });

const bucketArb = fc.integer({ min: 2, max: 1000 });

const inputArb = fc.record({
  serverSeed: hex64,
  clientSeed: clientSeedArb,
  nonce: nonceArb,
  instantCrashBucket: bucketArb,
});

test(
  "1000 fixed-seed rounds: deriveCrashPoint is deterministic and within sane bounds",
  () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const a = deriveCrashPoint(input);
        const b = deriveCrashPoint(input);
        expect(a).toBe(b);
        expect(Number.isFinite(a)).toBe(true);
        expect(a).toBeGreaterThanOrEqual(1.0);
        expect(a).toBeLessThanOrEqual(TWO_POW_52);
      }),
      { numRuns: 1000, seed: 0xc0ffee },
    );
  },
  30_000,
);

test(
  "parseInt of first 13 hex chars of HMAC-SHA-256 is always finite across 10k random inputs",
  () => {
    fc.assert(
      fc.property(hex64, clientSeedArb, nonceArb, (serverSeed, clientSeed, nonce) => {
        const hmac = createHmac("sha256", serverSeed)
          .update(`${clientSeed}:${nonce.toString()}`)
          .digest("hex");
        const intH = parseInt(hmac.substring(0, HEX_CHARS), 16);
        expect(Number.isFinite(intH)).toBe(true);
        expect(intH).toBeGreaterThanOrEqual(0);
        expect(intH).toBeLessThan(TWO_POW_52);
      }),
      { numRuns: 10_000, seed: 0xdeadbeef },
    );
  },
  60_000,
);
