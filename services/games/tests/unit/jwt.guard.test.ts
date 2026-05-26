import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { SignJWT, exportJWK, generateKeyPair, type KeyLike, type JWK } from "jose";
import type { Server } from "bun";

import { JwtGuard, type AuthenticatedRequest } from "../../src/presentation/guards/jwt.guard";

type FixtureKeys = {
  privateKey: KeyLike;
  publicJwk: JWK & { kid: string; alg: string };
};

const ISSUER = "http://test-keycloak/realms/crash-game";
const AUDIENCE = "crash-test-audience";

let validKeys: FixtureKeys;
let foreignKeys: FixtureKeys;
let jwksServer: Server;
let jwksUri: string;

async function makeKeys(kid: string): Promise<FixtureKeys> {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = kid;
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
  return { privateKey, publicJwk: publicJwk as JWK & { kid: string; alg: string } };
}

async function signToken(
  keys: FixtureKeys,
  overrides: { iss?: string; aud?: string | string[]; exp?: number; sub?: string } = {},
): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: keys.publicJwk.kid })
    .setSubject(overrides.sub ?? "player-uuid-1")
    .setIssuer(overrides.iss ?? ISSUER)
    .setAudience(overrides.aud ?? AUDIENCE)
    .setIssuedAt(nowSec)
    .setExpirationTime(overrides.exp ?? nowSec + 60)
    .sign(keys.privateKey);
}

function buildContext(authHeader: string | undefined): {
  ctx: ExecutionContext;
  req: Partial<AuthenticatedRequest>;
} {
  const req: Partial<AuthenticatedRequest> = {
    headers: authHeader === undefined ? {} : { authorization: authHeader },
  };
  const ctx = {
    switchToHttp: () => ({
      getRequest: <T>() => req as T,
    }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

beforeAll(async () => {
  validKeys = await makeKeys("test-key-valid");
  foreignKeys = await makeKeys("test-key-foreign");

  jwksServer = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({ keys: [validKeys.publicJwk] });
    },
  });
  jwksUri = `http://127.0.0.1:${jwksServer.port}/jwks`;
});

afterAll(() => {
  jwksServer.stop(true);
});

function makeGuard(): JwtGuard {
  return new JwtGuard({
    jwksUri,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

describe("JwtGuard", () => {
  test("missing Authorization header throws MISSING_BEARER_TOKEN", async () => {
    const guard = makeGuard();
    const { ctx } = buildContext(undefined);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      message: "MISSING_BEARER_TOKEN",
    });
  });

  test("malformed bearer (no Bearer prefix) throws MISSING_BEARER_TOKEN", async () => {
    const guard = makeGuard();
    const { ctx } = buildContext("Basic abc.def.ghi");
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      message: "MISSING_BEARER_TOKEN",
    });
  });

  test("valid token attaches req.user = { playerId, tokenExp } and returns true", async () => {
    const guard = makeGuard();
    const token = await signToken(validKeys, { sub: "player-42" });
    const { ctx, req } = buildContext(`Bearer ${token}`);

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(req.user?.playerId).toBe("player-42");
    expect(typeof req.user?.tokenExp).toBe("number");
    expect(req.user!.tokenExp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  test("mismatched iss claim throws INVALID_TOKEN", async () => {
    const guard = makeGuard();
    const token = await signToken(validKeys, { iss: "http://attacker/realms/evil" });
    const { ctx } = buildContext(`Bearer ${token}`);

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      message: "INVALID_TOKEN",
    });
  });

  test("mismatched aud claim throws INVALID_TOKEN", async () => {
    const guard = makeGuard();
    const token = await signToken(validKeys, { aud: "wrong-audience" });
    const { ctx } = buildContext(`Bearer ${token}`);

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      message: "INVALID_TOKEN",
    });
  });

  test("expired token throws INVALID_TOKEN", async () => {
    const guard = makeGuard();
    const expiredSec = Math.floor(Date.now() / 1000) - 120;
    const token = await signToken(validKeys, { exp: expiredSec });
    const { ctx } = buildContext(`Bearer ${token}`);

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      message: "INVALID_TOKEN",
    });
  });

  test("token signed by foreign key (signature fails) throws INVALID_TOKEN", async () => {
    const guard = makeGuard();
    const token = await signToken(foreignKeys);
    const { ctx } = buildContext(`Bearer ${token}`);

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      message: "INVALID_TOKEN",
    });
  });
});
