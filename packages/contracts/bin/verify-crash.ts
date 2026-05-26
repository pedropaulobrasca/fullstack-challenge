#!/usr/bin/env bun
import { deriveCrashPoint } from "../src/provably-fair";

type CliPayload = {
  serverSeed: string;
  clientSeed: string;
  nonce: string;
  instantCrashBucket: number;
  expectedCrashPoint: number;
};

const raw = await Bun.stdin.text();
const payload = JSON.parse(raw) as CliPayload;

const recomputed = deriveCrashPoint({
  serverSeed: payload.serverSeed,
  clientSeed: payload.clientSeed,
  nonce: BigInt(payload.nonce),
  instantCrashBucket: payload.instantCrashBucket,
});

if (recomputed === payload.expectedCrashPoint) {
  console.log(`MATCH ${recomputed}`);
  process.exit(0);
} else {
  console.log(`MISMATCH expected=${payload.expectedCrashPoint} got=${recomputed}`);
  process.exit(1);
}
