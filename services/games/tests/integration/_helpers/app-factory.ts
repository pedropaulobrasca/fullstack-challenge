/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadAppModule } from "./test-env";

export type TestGamesApp = {
  app: any;
  em: any;
  baseUrl: string;
};

export async function createTestGamesApp(): Promise<TestGamesApp> {
  const { Test, AppModule, EntityManager } = await loadAppModule();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.enableShutdownHooks();
  await app.init();
  await app.listen(0, "127.0.0.1");
  const address = (app.getHttpServer().address?.() ?? {}) as {
    port?: number;
  };
  const port = address.port ?? 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  const em = app.get(EntityManager).fork();
  return { app, em, baseUrl };
}

export async function truncateGamesTables(em: any): Promise<void> {
  const conn = em.getConnection();
  await conn.execute("TRUNCATE TABLE bets RESTART IDENTITY CASCADE");
  await conn.execute("TRUNCATE TABLE rounds RESTART IDENTITY CASCADE");
  await conn.execute("TRUNCATE TABLE seed_chain RESTART IDENTITY CASCADE");
}

export async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 50,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

export async function pollRound(
  em: any,
  predicate: (row: any) => boolean,
  timeoutMs = 5000,
): Promise<any> {
  let last: any = null;
  await waitFor(async () => {
    const rows = await em
      .getConnection()
      .execute("SELECT * FROM rounds ORDER BY nonce DESC LIMIT 1");
    last = rows[0] ?? null;
    return last !== null && predicate(last);
  }, timeoutMs);
  return last;
}
