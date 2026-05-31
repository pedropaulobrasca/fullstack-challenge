import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Money } from "@crash/shared-kernel";
import { PlayerId, WalletId } from "@crash/shared-kernel/identity";
import type {
  ApplyCreditResult,
  ApplyDebitResult,
  WalletRepository,
} from "../../src/domain/wallet.repository";
import type {
  AppendTransactionContext,
  TransactionRepository,
} from "../../src/domain/transaction.repository";
import { Wallet } from "../../src/domain/wallet.aggregate";
import type { Transaction } from "../../src/domain/transaction.aggregate";

process.env.KEYCLOAK_ISSUER ??= "http://localhost:8080/realms/crash-game";
process.env.KEYCLOAK_JWKS_URI ??=
  "http://localhost:8080/realms/crash-game/protocol/openid-connect/certs";
process.env.KEYCLOAK_AUDIENCE ??= "account";
process.env.INITIAL_BALANCE_CENTS ??= "100000";
process.env.DEV_TOPUP_ENABLED = "true";
process.env.DEV_TOPUP_CENTS = "100000";

type TopUpCtor = typeof import(
  "../../src/application/use-cases/top-up-wallet.use-case"
)["TopUpWalletUseCase"];
type ProvisionCtor = typeof import(
  "../../src/application/use-cases/provision-wallet.use-case"
)["ProvisionWalletUseCase"];

let TopUpWalletUseCase: TopUpCtor;
let ProvisionWalletUseCase: ProvisionCtor;

beforeAll(async () => {
  ({ TopUpWalletUseCase } = await import(
    "../../src/application/use-cases/top-up-wallet.use-case"
  ));
  ({ ProvisionWalletUseCase } = await import(
    "../../src/application/use-cases/provision-wallet.use-case"
  ));
});

class InMemoryWalletRepository implements WalletRepository {
  private readonly walletsByPlayerId = new Map<string, Wallet>();

  async findByPlayerId(playerId: PlayerId): Promise<Wallet | null> {
    return this.walletsByPlayerId.get(playerId as unknown as string) ?? null;
  }

  async save(wallet: Wallet): Promise<void> {
    this.walletsByPlayerId.set(wallet.playerId as unknown as string, wallet);
  }

  async applyDebitAtomically(): Promise<ApplyDebitResult> {
    throw new Error("not used by TopUpWalletUseCase");
  }

  async applyCreditAtomically(
    playerId: PlayerId,
    amount: Money,
  ): Promise<ApplyCreditResult> {
    const wallet = this.walletsByPlayerId.get(playerId as unknown as string);
    if (!wallet) return { kind: "NOT_FOUND" };
    const previousBalance = wallet.balance;
    const newBalance = previousBalance.add(amount);
    const next = Wallet.rehydrate({
      id: wallet.id,
      playerId: wallet.playerId,
      balance: newBalance,
      createdAt: wallet.createdAt,
      updatedAt: new Date(),
    });
    this.walletsByPlayerId.set(playerId as unknown as string, next);
    return {
      kind: "OK",
      walletId: WalletId(wallet.id),
      newBalance,
      previousBalance,
    };
  }
}

class InMemoryTransactionRepository implements TransactionRepository {
  readonly appended: Array<{ tx: Transaction; ctx: AppendTransactionContext }> = [];

  async append(tx: Transaction, ctx: AppendTransactionContext): Promise<void> {
    this.appended.push({ tx, ctx });
  }
}

class FakeEntityManager {
  async transactional<T>(cb: (em: unknown) => Promise<T>): Promise<T> {
    return cb(this);
  }
}

describe("TopUpWalletUseCase", () => {
  let walletRepo: InMemoryWalletRepository;
  let txRepo: InMemoryTransactionRepository;
  let useCase: InstanceType<TopUpCtor>;

  beforeEach(() => {
    walletRepo = new InMemoryWalletRepository();
    txRepo = new InMemoryTransactionRepository();
    const em = new FakeEntityManager();
    const provision = new ProvisionWalletUseCase(em as unknown as never, walletRepo);
    useCase = new TopUpWalletUseCase(
      em as unknown as never,
      provision,
      walletRepo,
      txRepo,
    );
  });

  test("credits DEV_TOPUP_CENTS to caller and returns the updated wallet", async () => {
    const playerId = PlayerId("player-topup-1");
    const result = await useCase.execute(playerId);

    expect(result.amount.equals(Money.of(100000n))).toBe(true);
    expect(result.wallet.playerId).toBe(playerId);
    expect(result.wallet.balance.equals(Money.of(200000n))).toBe(true);
    expect(txRepo.appended).toHaveLength(1);
    expect(txRepo.appended[0]!.tx.kind).toBe("CREDIT");
    expect(txRepo.appended[0]!.tx.amount.equals(Money.of(100000n))).toBe(true);
  });

  test("two consecutive top-ups stack on top of the initial balance", async () => {
    const playerId = PlayerId("player-topup-2");
    await useCase.execute(playerId);
    const second = await useCase.execute(playerId);

    expect(second.wallet.balance.equals(Money.of(300000n))).toBe(true);
    expect(txRepo.appended).toHaveLength(2);
  });

  test("throws ServiceUnavailableException when DEV_TOPUP_ENABLED is false", async () => {
    const originalEnabled = process.env.DEV_TOPUP_ENABLED;
    process.env.DEV_TOPUP_ENABLED = "false";
    delete require.cache[require.resolve("../../src/config/defaults")];
    delete require.cache[
      require.resolve("../../src/application/use-cases/top-up-wallet.use-case")
    ];
    delete require.cache[
      require.resolve("../../src/application/use-cases/provision-wallet.use-case")
    ];

    try {
      const { TopUpWalletUseCase: GuardedCtor } = await import(
        "../../src/application/use-cases/top-up-wallet.use-case"
      );
      const { ProvisionWalletUseCase: GuardedProvisionCtor } = await import(
        "../../src/application/use-cases/provision-wallet.use-case"
      );
      const repo = new InMemoryWalletRepository();
      const txs = new InMemoryTransactionRepository();
      const em = new FakeEntityManager();
      const provision = new GuardedProvisionCtor(em as unknown as never, repo);
      const guarded = new GuardedCtor(em as unknown as never, provision, repo, txs);

      await expect(guarded.execute(PlayerId("player-disabled"))).rejects.toMatchObject({
        response: { code: "DEV_TOPUP_DISABLED" },
      });
    } finally {
      process.env.DEV_TOPUP_ENABLED = originalEnabled;
      delete require.cache[require.resolve("../../src/config/defaults")];
      delete require.cache[
        require.resolve("../../src/application/use-cases/top-up-wallet.use-case")
      ];
      delete require.cache[
        require.resolve("../../src/application/use-cases/provision-wallet.use-case")
      ];
    }
  });
});
