import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { Money } from "@crash/shared-kernel";
import { CorrelationId, PlayerId, WalletId } from "@crash/shared-kernel/identity";
import { env } from "../../config/defaults";
import { Wallet } from "../../domain/wallet.aggregate";
import { Transaction } from "../../domain/transaction.aggregate";
import type { WalletRepository } from "../../domain/wallet.repository";
import type { TransactionRepository } from "../../domain/transaction.repository";
import { ProvisionWalletUseCase } from "./provision-wallet.use-case";
import { TRANSACTION_REPOSITORY, WALLET_REPOSITORY } from "./tokens";

export type TopUpResult = {
  wallet: Wallet;
  amount: Money;
};

@Injectable()
export class TopUpWalletUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly provision: ProvisionWalletUseCase,
    @Inject(WALLET_REPOSITORY) private readonly walletRepo: WalletRepository,
    @Inject(TRANSACTION_REPOSITORY) private readonly txRepo: TransactionRepository,
  ) {}

  async execute(playerId: PlayerId): Promise<TopUpResult> {
    if (!env.DEV_TOPUP_ENABLED) {
      throw new ServiceUnavailableException({
        code: "DEV_TOPUP_DISABLED",
        message: "Developer top-up is disabled in this environment.",
      });
    }

    await this.provision.execute(playerId);

    const amount = Money.of(env.DEV_TOPUP_CENTS);

    return this.em.transactional(async (txEm) => {
      const result = await this.walletRepo.applyCreditAtomically(playerId, amount, txEm);
      if (result.kind === "NOT_FOUND") {
        throw new ServiceUnavailableException({
          code: "WALLET_NOT_FOUND",
          message: "Wallet could not be provisioned for top-up.",
        });
      }

      const messageId = crypto.randomUUID();
      const correlationId = CorrelationId(crypto.randomUUID());
      const transaction = Transaction.record({
        walletId: WalletId(result.walletId),
        kind: "CREDIT",
        amount,
        correlationId,
        messageId,
        previousBalance: result.previousBalance,
        newBalance: result.newBalance,
        appliedAt: new Date(),
      });
      await this.txRepo.append(transaction, { playerId, txEm });

      const wallet = await this.walletRepo.findByPlayerId(playerId);
      if (!wallet) {
        throw new ServiceUnavailableException({
          code: "WALLET_NOT_FOUND",
          message: "Wallet vanished after top-up credit.",
        });
      }
      return { wallet, amount };
    });
  }
}
