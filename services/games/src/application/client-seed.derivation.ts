import { createHash } from "node:crypto";
import { GENESIS_CLIENT_SEED } from "@crash/contracts";
import type { RoundId } from "@crash/shared-kernel";

export type PreviousRoundClose = {
  id: RoundId;
  crashedAt: Date;
};

export function deriveClientSeed(prevRound: PreviousRoundClose | null): string {
  if (prevRound === null) {
    return createHash("sha256").update(GENESIS_CLIENT_SEED).digest("hex");
  }
  const material = `${prevRound.id as unknown as string}:${prevRound.crashedAt.toISOString()}`;
  return createHash("sha256").update(material).digest("hex");
}
