import type { RoundId } from "@crash/shared-kernel";
import type { Round } from "./round.aggregate";
import type { CrashPoint } from "./value-objects/crash-point";

export interface RoundRepository {
  findById(id: RoundId): Promise<Round | null>;
  findOpen(): Promise<Round | null>;
  findServerSeedByNonce(nonce: bigint): Promise<string | null>;
  maxNonce(): Promise<bigint | null>;
  listSettledHistory(limit: number, offset: number): Promise<Round[]>;
  saveScheduled(round: Round): Promise<void>;
  transitionFromBettingToRunning(
    id: RoundId,
    startedAt: Date,
    txEm?: unknown,
  ): Promise<Round | null>;
  transitionFromRunningToCrashed(
    id: RoundId,
    crashPoint: CrashPoint,
    crashedAt: Date,
    txEm?: unknown,
  ): Promise<Round | null>;
  transitionFromCrashedToSettled(
    id: RoundId,
    serverSeed: string,
    settledAt: Date,
    txEm?: unknown,
  ): Promise<Round | null>;
}
