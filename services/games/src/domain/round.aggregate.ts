import type { RoundId } from "@crash/shared-kernel";
import type { RoundStatus } from "./value-objects/round-status";
import { CrashPoint } from "./value-objects/crash-point";
import { isValidSeedHex } from "./value-objects/seed";
import { IllegalRoundTransitionError } from "./errors";

export type RoundProps = {
  id: RoundId;
  nonce: bigint;
  status: RoundStatus;
  seedHash: string;
  clientSeed: string;
  serverSeed: string | null;
  crashPoint: CrashPoint | null;
  formulaVersion: number;
  bettingEndsAt: Date;
  startedAt: Date | null;
  crashedAt: Date | null;
  settledAt: Date | null;
  createdAt: Date;
};

export class Round {
  private constructor(private readonly props: RoundProps) {}

  static schedule(
    id: RoundId,
    nonce: bigint,
    seedHash: string,
    clientSeed: string,
    formulaVersion: number,
    bettingEndsAt: Date,
    now: Date,
  ): Round {
    return new Round({
      id,
      nonce,
      status: "BETTING",
      seedHash,
      clientSeed,
      serverSeed: null,
      crashPoint: null,
      formulaVersion,
      bettingEndsAt,
      startedAt: null,
      crashedAt: null,
      settledAt: null,
      createdAt: now,
    });
  }

  static rehydrate(props: RoundProps): Round {
    return new Round(props);
  }

  get id(): RoundId {
    return this.props.id;
  }

  get nonce(): bigint {
    return this.props.nonce;
  }

  get status(): RoundStatus {
    return this.props.status;
  }

  get seedHash(): string {
    return this.props.seedHash;
  }

  get clientSeed(): string {
    return this.props.clientSeed;
  }

  get serverSeed(): string | null {
    return this.props.serverSeed;
  }

  get crashPoint(): CrashPoint | null {
    return this.props.crashPoint;
  }

  get formulaVersion(): number {
    return this.props.formulaVersion;
  }

  get bettingEndsAt(): Date {
    return this.props.bettingEndsAt;
  }

  get startedAt(): Date | null {
    return this.props.startedAt;
  }

  get crashedAt(): Date | null {
    return this.props.crashedAt;
  }

  get settledAt(): Date | null {
    return this.props.settledAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  start(now: Date): Round {
    if (this.props.status !== "BETTING") {
      throw new IllegalRoundTransitionError(this.props.status, "RUNNING");
    }
    return new Round({ ...this.props, status: "RUNNING", startedAt: now });
  }

  crash(at: CrashPoint, time: Date): Round {
    if (this.props.status !== "RUNNING") {
      throw new IllegalRoundTransitionError(this.props.status, "CRASHED");
    }
    return new Round({ ...this.props, status: "CRASHED", crashPoint: at, crashedAt: time });
  }

  settle(serverSeed: string, now: Date): Round {
    if (this.props.status !== "CRASHED") {
      throw new IllegalRoundTransitionError(this.props.status, "SETTLED");
    }
    if (!isValidSeedHex(serverSeed)) {
      throw new IllegalRoundTransitionError(this.props.status, "SETTLED");
    }
    return new Round({ ...this.props, status: "SETTLED", serverSeed, settledAt: now });
  }
}
