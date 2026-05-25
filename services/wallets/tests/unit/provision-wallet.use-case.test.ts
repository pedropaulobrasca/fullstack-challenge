import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Money, PlayerId } from "@crash/shared-kernel";
import type {
  ApplyCreditResult,
  ApplyDebitResult,
  WalletRepository,
} from "../../src/domain/wallet.repository";
import { Wallet } from "../../src/domain/wallet.aggregate";

process.env.KEYCLOAK_ISSUER ??= "http://localhost:8080/realms/crash-game";
process.env.KEYCLOAK_JWKS_URI ??=
  "http://localhost:8080/realms/crash-game/protocol/openid-connect/certs";
process.env.KEYCLOAK_AUDIENCE ??= "account";
process.env.INITIAL_BALANCE_CENTS ??= "100000";

type ProvisionWalletUseCaseCtor = typeof import(
  "../../src/application/use-cases/provision-wallet.use-case"
)["ProvisionWalletUseCase"];
type WalletsEnv = typeof import("../../src/config/defaults")["env"];

let ProvisionWalletUseCase: ProvisionWalletUseCaseCtor;
let env: WalletsEnv;

beforeAll(async () => {
  ({ ProvisionWalletUseCase } = await import(
    "../../src/application/use-cases/provision-wallet.use-case"
  ));
  ({ env } = await import("../../src/config/defaults"));
});

type SaveFn = (wallet: Wallet) => Promise<void>;

class InMemoryWalletRepository implements WalletRepository {
  private readonly walletsByPlayerId = new Map<string, Wallet>();
  saveImpl: SaveFn = async (wallet) => {
    this.walletsByPlayerId.set(wallet.playerId as unknown as string, wallet);
  };

  async findByPlayerId(playerId: PlayerId): Promise<Wallet | null> {
    return this.walletsByPlayerId.get(playerId as unknown as string) ?? null;
  }

  async save(wallet: Wallet): Promise<void> {
    await this.saveImpl(wallet);
  }

  async applyDebitAtomically(): Promise<ApplyDebitResult> {
    throw new Error("not used by ProvisionWalletUseCase");
  }

  async applyCreditAtomically(): Promise<ApplyCreditResult> {
    throw new Error("not used by ProvisionWalletUseCase");
  }

  forcePut(wallet: Wallet): void {
    this.walletsByPlayerId.set(wallet.playerId as unknown as string, wallet);
  }
}

class FakeEntityManager {
  transactionalCallCount = 0;
  async transactional<T>(cb: () => Promise<T>): Promise<T> {
    this.transactionalCallCount += 1;
    return cb();
  }
}

function buildUseCase() {
  const repo = new InMemoryWalletRepository();
  const em = new FakeEntityManager();
  const useCase = new ProvisionWalletUseCase(em as unknown as never, repo);
  return { repo, em, useCase };
}

describe("ProvisionWalletUseCase", () => {
  let repo: InMemoryWalletRepository;
  let em: FakeEntityManager;
  let useCase: InstanceType<ProvisionWalletUseCaseCtor>;

  beforeEach(() => {
    ({ repo, em, useCase } = buildUseCase());
  });

  test("first call creates a wallet at INITIAL_BALANCE_CENTS", async () => {
    const result = await useCase.execute(PlayerId("p-1"));

    expect(result.created).toBe(true);
    expect(result.wallet.playerId).toBe(PlayerId("p-1"));
    expect(result.wallet.balance.equals(Money.of(env.INITIAL_BALANCE_CENTS))).toBe(true);
  });

  test("second call for the same playerId returns the existing wallet (created=false)", async () => {
    const first = await useCase.execute(PlayerId("p-2"));
    const second = await useCase.execute(PlayerId("p-2"));

    expect(second.created).toBe(false);
    expect(second.wallet.id).toBe(first.wallet.id);
    expect(second.wallet.balance.equals(first.wallet.balance)).toBe(true);
  });

  test("two distinct playerIds each get their own wallet with distinct ids", async () => {
    const a = await useCase.execute(PlayerId("p-a"));
    const b = await useCase.execute(PlayerId("p-b"));

    expect(a.created).toBe(true);
    expect(b.created).toBe(true);
    expect(a.wallet.id).not.toBe(b.wallet.id);
  });

  test("UNIQUE(player_id) race (SQLSTATE 23505) on save resolves to the racing wallet without creating a duplicate", async () => {
    let racingWallet: Wallet | null = null;

    repo.saveImpl = async (wallet) => {
      racingWallet = Wallet.rehydrate({
        id: wallet.id,
        playerId: wallet.playerId,
        balance: Money.of(env.INITIAL_BALANCE_CENTS),
        createdAt: wallet.createdAt,
        updatedAt: wallet.updatedAt,
      });
      repo.forcePut(racingWallet);
      const err = new Error(
        'duplicate key value violates unique constraint "wallets_player_id_unique"',
      ) as Error & { code: string };
      err.code = "23505";
      throw err;
    };

    const result = await useCase.execute(PlayerId("p-race"));

    expect(result.created).toBe(false);
    expect(result.wallet).toBe(racingWallet as unknown as Wallet);
  });

  test("em.transactional is invoked exactly once per execute() call", async () => {
    await useCase.execute(PlayerId("p-tx-1"));
    expect(em.transactionalCallCount).toBe(1);

    await useCase.execute(PlayerId("p-tx-1"));
    expect(em.transactionalCallCount).toBe(2);

    await useCase.execute(PlayerId("p-tx-2"));
    expect(em.transactionalCallCount).toBe(3);
  });
});
