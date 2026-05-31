import type { PlayerId } from "./branded-id";
import { sha256Hex } from "./sha256";

export function maskPlayerId(playerId: PlayerId): string {
  return sha256Hex(playerId as unknown as string).substring(0, 8);
}
