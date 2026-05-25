/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Server } from "bun";
import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWK,
  type KeyLike,
} from "jose";

const ISSUER = "http://test-keycloak/realms/crash-game";
const AUDIENCE = "crash-test-audience";

type FixtureKeys = {
  privateKey: KeyLike;
  publicJwk: JWK & { kid: string; alg: string };
};

let jwksServer: Server | undefined;
let jwksUri: string | undefined;
let validKeys: FixtureKeys | undefined;
let foreignKeys: FixtureKeys | undefined;

async function makeKeys(kid: string): Promise<FixtureKeys> {
  const { privateKey, publicKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = kid;
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
  return {
    privateKey,
    publicJwk: publicJwk as JWK & { kid: string; alg: string },
  };
}

async function startJwksServer(): Promise<void> {
  if (jwksServer) return;
  validKeys = await makeKeys("integration-key-valid");
  foreignKeys = await makeKeys("integration-key-foreign");
  jwksServer = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({ keys: [validKeys!.publicJwk] });
    },
  });
  jwksUri = `http://127.0.0.1:${jwksServer.port}/jwks`;
}

export async function ensureTestEnv(): Promise<{
  jwksUri: string;
  issuer: string;
  audience: string;
}> {
  await startJwksServer();
  process.env.DATABASE_URL = "postgresql://admin:admin@localhost:5432/wallets";
  process.env.RABBITMQ_URL = "amqp://admin:admin@localhost:5672";
  process.env.NODE_ENV = "test";
  process.env.PORT = "4499";
  process.env.CURRENCY_CODE = "CRD";
  process.env.CURRENCY_BASE = "10";
  process.env.CURRENCY_EXPONENT = "2";
  process.env.INITIAL_BALANCE_CENTS = "100000";
  process.env.OUTBOX_POLL_INTERVAL_MS = "200";
  process.env.OUTBOX_POLL_BATCH_SIZE = "100";
  process.env.RMQ_DELIVERY_LIMIT_MAIN = "5";
  process.env.RMQ_DELIVERY_LIMIT_DLQ = "3";
  process.env.KEYCLOAK_ISSUER = ISSUER;
  process.env.KEYCLOAK_JWKS_URI = jwksUri!;
  process.env.KEYCLOAK_AUDIENCE = AUDIENCE;
  return { jwksUri: jwksUri!, issuer: ISSUER, audience: AUDIENCE };
}

export async function bootstrapWalletsApp(): Promise<{
  app: any;
  em: any;
  baseUrl: string;
  stop: () => Promise<void>;
}> {
  await ensureTestEnv();
  const { Test } = await import("@nestjs/testing");
  const { AppModule } = await import("../../src/app.module");
  const { EntityManager } = await import("@mikro-orm/postgresql");

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
  return {
    app,
    em,
    baseUrl,
    stop: async () => {
      await app.close().catch(() => undefined);
    },
  };
}

export interface MintTestJwtOpts {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  signWithForeign?: boolean;
}

export async function mintTestJwt(
  playerId: string,
  opts: MintTestJwtOpts = {},
): Promise<string> {
  await startJwksServer();
  const keys = opts.signWithForeign ? foreignKeys! : validKeys!;
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: keys.publicJwk.kid })
    .setSubject(playerId)
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? AUDIENCE)
    .setIssuedAt(nowSec)
    .setExpirationTime(opts.exp ?? nowSec + 60)
    .sign(keys.privateKey);
}

export async function resetWalletsSchema(em: any): Promise<void> {
  const conn = em.getConnection();
  await conn.execute("TRUNCATE TABLE transactions RESTART IDENTITY CASCADE");
  await conn.execute(
    "TRUNCATE TABLE wallets RESTART IDENTITY CASCADE",
  );
  await conn.execute("TRUNCATE TABLE outbox RESTART IDENTITY CASCADE");
  await conn.execute("TRUNCATE TABLE inbox RESTART IDENTITY CASCADE");
  await conn.execute(
    "TRUNCATE TABLE dead_letter_messages RESTART IDENTITY CASCADE",
  );
}

export async function stopJwksServer(): Promise<void> {
  if (jwksServer) {
    jwksServer.stop(true);
    jwksServer = undefined;
    jwksUri = undefined;
  }
}
