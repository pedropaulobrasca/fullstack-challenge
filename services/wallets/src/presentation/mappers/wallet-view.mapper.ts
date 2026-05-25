import { serializeMoney } from "@crash/contracts";
import { env } from "../../config/defaults";
import type { Wallet } from "../../domain/wallet.aggregate";
import type { WalletViewDto } from "../dtos/wallet-view.dto";

export const WalletView = {
  from(wallet: Wallet): WalletViewDto {
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: serializeMoney(wallet.balance),
      currency: env.CURRENCY_CODE,
      createdAt: wallet.createdAt.toISOString(),
      updatedAt: wallet.updatedAt.toISOString(),
    };
  },
};
