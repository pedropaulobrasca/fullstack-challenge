import { createHmac } from "node:crypto";
import { HEX_CHARS, TWO_POW_52 } from "./formulas.constants";
import type { DeriveCrashPointInput } from "./types";

export function deriveCrashPoint(input: DeriveCrashPointInput): number {
  const message = `${input.clientSeed}:${input.nonce.toString()}`;
  const hmac = createHmac("sha256", input.serverSeed).update(message).digest("hex");
  const first13 = hmac.substring(0, HEX_CHARS);
  const intH = parseInt(first13, 16);

  if (intH % input.instantCrashBucket === 0) {
    return 1.0;
  }

  const crash = Math.floor((100 * TWO_POW_52 - intH) / (TWO_POW_52 - intH)) / 100;
  return Math.max(1.0, crash);
}
