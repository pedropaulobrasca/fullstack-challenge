import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import "../setup";
import { UnauthorizedException } from "@nestjs/common";

type JwtVerifyMock = ReturnType<typeof mock>;

let jwtVerifyMock: JwtVerifyMock;

async function loadService(): Promise<typeof import("../../src/presentation/auth/jwt-verifier.service")> {
  jwtVerifyMock = mock(async () => ({
    payload: { sub: "player-default", exp: Math.floor(Date.now() / 1000) + 60 },
  }));
  mock.module("jose", () => ({
    createRemoteJWKSet: () => () => undefined,
    jwtVerify: jwtVerifyMock,
  }));
  delete require.cache[require.resolve("../../src/presentation/auth/jwt-verifier.service")];
  return await import("../../src/presentation/auth/jwt-verifier.service");
}

describe("JwtVerifierService", () => {
  let service: import("../../src/presentation/auth/jwt-verifier.service").JwtVerifierService;

  beforeEach(async () => {
    const mod = await loadService();
    service = new mod.JwtVerifierService();
  });

  afterEach(() => {
    mock.restore();
  });

  test("valid payload returns playerId and tokenExp", async () => {
    jwtVerifyMock.mockResolvedValueOnce({
      payload: { sub: "player-uuid-1", exp: 9_999_999_999 },
    });

    const result = await service.verify("any-token");

    expect(result).toEqual({ playerId: "player-uuid-1", tokenExp: 9_999_999_999 });
  });

  test("jwtVerify rejection becomes UnauthorizedException INVALID_TOKEN", async () => {
    jwtVerifyMock.mockRejectedValue(new Error("JWSInvalid"));

    await expect(service.verify("bad-token")).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.verify("bad-token")).rejects.toMatchObject({ message: "INVALID_TOKEN" });
  });

  test("missing sub claim throws UnauthorizedException INVALID_TOKEN", async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { exp: 9_999_999_999 } });

    await expect(service.verify("any-token")).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.verify("any-token")).rejects.toMatchObject({ message: "INVALID_TOKEN" });
  });

  test("missing exp claim throws UnauthorizedException INVALID_TOKEN", async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { sub: "player-uuid-1" } });

    await expect(service.verify("any-token")).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.verify("any-token")).rejects.toMatchObject({ message: "INVALID_TOKEN" });
  });

  test("non-string sub is rejected", async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { sub: 12345, exp: 9_999_999_999 } });

    await expect(service.verify("any-token")).rejects.toMatchObject({ message: "INVALID_TOKEN" });
  });

  test("non-number exp is rejected", async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { sub: "player-uuid-1", exp: "soon" } });

    await expect(service.verify("any-token")).rejects.toMatchObject({ message: "INVALID_TOKEN" });
  });
});
