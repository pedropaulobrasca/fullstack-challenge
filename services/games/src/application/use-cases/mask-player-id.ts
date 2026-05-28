import { createHash } from "node:crypto";
import type { PlayerId } from "@crash/shared-kernel";

export function maskPlayerId(playerId: PlayerId): string {
  return createHash("sha256")
    .update(playerId as unknown as string)
    .digest("hex")
    .substring(0, 8);
}
