import { describe, expect, mock, test } from "bun:test";
import "../setup";
import { UnauthorizedException, type ExecutionContext } from "@nestjs/common";

import { JwtGuard, type AuthenticatedRequest } from "../../src/presentation/guards/jwt.guard";
import type { JwtVerifierService, VerifiedClaims } from "../../src/presentation/auth/jwt-verifier.service";

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

function makeVerifierStub(impl: (token: string) => Promise<VerifiedClaims>): {
  verifier: JwtVerifierService;
  verify: ReturnType<typeof mock>;
} {
  const verify = mock(impl);
  const verifier = { verify } as unknown as JwtVerifierService;
  return { verifier, verify };
}

describe("JwtGuard", () => {
  test("missing Authorization header throws MISSING_BEARER_TOKEN without invoking verifier", async () => {
    const { verifier, verify } = makeVerifierStub(async () => ({
      playerId: "should-not-run",
      tokenExp: 0,
    }));
    const guard = new JwtGuard(verifier);
    const { ctx } = buildContext(undefined);

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ message: "MISSING_BEARER_TOKEN" });
    expect(verify).not.toHaveBeenCalled();
  });

  test("malformed bearer (no Bearer prefix) throws MISSING_BEARER_TOKEN", async () => {
    const { verifier, verify } = makeVerifierStub(async () => ({
      playerId: "should-not-run",
      tokenExp: 0,
    }));
    const guard = new JwtGuard(verifier);
    const { ctx } = buildContext("Basic abc.def.ghi");

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ message: "MISSING_BEARER_TOKEN" });
    expect(verify).not.toHaveBeenCalled();
  });

  test("empty token after Bearer prefix throws MISSING_BEARER_TOKEN", async () => {
    const { verifier, verify } = makeVerifierStub(async () => ({
      playerId: "should-not-run",
      tokenExp: 0,
    }));
    const guard = new JwtGuard(verifier);
    const { ctx } = buildContext("Bearer    ");

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ message: "MISSING_BEARER_TOKEN" });
    expect(verify).not.toHaveBeenCalled();
  });

  test("valid token attaches req.user from verifier claims and returns true", async () => {
    const { verifier, verify } = makeVerifierStub(async () => ({
      playerId: "player-42",
      tokenExp: 9_999_999_999,
    }));
    const guard = new JwtGuard(verifier);
    const { ctx, req } = buildContext("Bearer header.payload.signature");

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(req.user).toEqual({ playerId: "player-42", tokenExp: 9_999_999_999 });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith("header.payload.signature");
  });

  test("verifier rejection bubbles up as UnauthorizedException INVALID_TOKEN", async () => {
    const { verifier } = makeVerifierStub(async () => {
      throw new UnauthorizedException("INVALID_TOKEN");
    });
    const guard = new JwtGuard(verifier);
    const { ctx, req } = buildContext("Bearer some.bad.token");

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ message: "INVALID_TOKEN" });
    expect(req.user).toBeUndefined();
  });
});
