import { Inject, Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { Money, PlayerId, WalletId } from "@crash/shared-kernel";
import { env } from "../../config/defaults";
import { Wallet } from "../../domain/wallet.aggregate";
import type { WalletRepository } from "../../domain/wallet.repository";
import { WALLET_REPOSITORY } from "./tokens";

const POSTGRES_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const maybe = err as { code?: unknown };
  return maybe.code === POSTGRES_UNIQUE_VIOLATION;
}

@Injectable()
export class ProvisionWalletUseCase {
  constructor(
    private readonly em: EntityManager,
    @Inject(WALLET_REPOSITORY) private readonly walletRepo: WalletRepository,
  ) {}

  async execute(playerId: PlayerId): Promise<{ created: boolean; wallet: Wallet }> {
    return this.em.transactional(async () => {
      const existing = await this.walletRepo.findByPlayerId(playerId);
      if (existing) return { created: false, wallet: existing };

      const wallet = Wallet.provision(
        WalletId(crypto.randomUUID()),
        playerId,
        Money.of(env.INITIAL_BALANCE_CENTS),
        new Date(),
      );

      try {
        await this.walletRepo.save(wallet);
        return { created: true, wallet };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        const raced = await this.walletRepo.findByPlayerId(playerId);
        if (!raced) throw err;
        return { created: false, wallet: raced };
      }
    });
  }
}
