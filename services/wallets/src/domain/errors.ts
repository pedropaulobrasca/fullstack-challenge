// Domain layer: zero infra imports — do not add @nestjs/*, @mikro-orm/*, or zod here.
import { DomainError } from "@crash/shared-kernel";
import type { MoneySnapshot, PlayerId, WalletId } from "@crash/shared-kernel";

export class InsufficientFundsError extends DomainError {
  readonly code = "INSUFFICIENT_FUNDS";
  readonly playerId: PlayerId;
  readonly requested: MoneySnapshot;
  readonly available: MoneySnapshot;

  constructor(params: { playerId: PlayerId; requested: MoneySnapshot; available: MoneySnapshot }) {
    super(
      `Insufficient funds for player ${params.playerId}: requested ${params.requested.amount} ${params.requested.currency}, available ${params.available.amount} ${params.available.currency}`,
    );
    this.playerId = params.playerId;
    this.requested = params.requested;
    this.available = params.available;
  }
}

export class WalletNotFoundError extends DomainError {
  readonly code = "WALLET_NOT_FOUND";
  readonly playerId: PlayerId;

  constructor(params: { playerId: PlayerId }) {
    super(`Wallet not found for player ${params.playerId}`);
    this.playerId = params.playerId;
  }
}

export class WalletAlreadyExistsError extends DomainError {
  readonly code = "WALLET_ALREADY_EXISTS";
  readonly playerId: PlayerId;
  readonly walletId: WalletId;

  constructor(params: { playerId: PlayerId; walletId: WalletId }) {
    super(`Wallet ${params.walletId} already exists for player ${params.playerId}`);
    this.playerId = params.playerId;
    this.walletId = params.walletId;
  }
}
