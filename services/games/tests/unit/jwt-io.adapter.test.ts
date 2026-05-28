import { beforeAll, describe, expect, mock, test } from "bun:test";
import { setupGamesTestEnv } from "../setup";

setupGamesTestEnv();

import type { INestApplicationContext } from "@nestjs/common";
import type { JwtVerifierService, VerifiedClaims } from "../../src/presentation/auth/jwt-verifier.service";

type AdapterCtor = typeof import("../../src/presentation/adapters/jwt-io.adapter")["JwtIoAdapter"];

let JwtIoAdapter: AdapterCtor;

beforeAll(async () => {
  ({ JwtIoAdapter } = await import(
    "../../src/presentation/adapters/jwt-io.adapter"
  ));
});

type CapturedMiddleware = (socket: any, next: (err?: Error) => void) => Promise<void> | void;

class FakeServer {
  middlewares: CapturedMiddleware[] = [];
  use(mw: CapturedMiddleware): this {
    this.middlewares.push(mw);
    return this;
  }
}

function buildAppContextStub(): INestApplicationContext {
  return {
    get: () => undefined,
    select: () => ({}) as never,
    resolve: async () => undefined,
    init: async () => ({}) as never,
    close: async () => undefined,
    enableShutdownHooks: () => ({}) as never,
    useLogger: () => undefined,
    flushLogs: () => undefined,
  } as unknown as INestApplicationContext;
}

function buildVerifierStub(verifyFn: (token: string) => Promise<VerifiedClaims>): JwtVerifierService {
  return { verify: verifyFn } as unknown as JwtVerifierService;
}

function buildAdapter(verifier: JwtVerifierService): {
  middleware: CapturedMiddleware;
} {
  const adapter = new JwtIoAdapter(buildAppContextStub(), verifier);
  const fakeServer = new FakeServer();
  const originalSuper = Object.getPrototypeOf(Object.getPrototypeOf(adapter));
  const originalCreateIO = originalSuper.createIOServer;
  originalSuper.createIOServer = function () {
    return fakeServer as never;
  };
  try {
    adapter.createIOServer(0, undefined as never);
  } finally {
    originalSuper.createIOServer = originalCreateIO;
  }
  const middleware = fakeServer.middlewares[0];
  if (!middleware) throw new Error("no middleware attached");
  return { middleware };
}

describe("JwtIoAdapter middleware", () => {
  test("rejects when no token is present", async () => {
    const verifier = buildVerifierStub(mock(async () => ({ playerId: "p", tokenExp: 1 })));
    const { middleware } = buildAdapter(verifier);
    const next = mock();
    const socket: any = { handshake: {}, data: {} };
    await middleware(socket, next);
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]![0] as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("UNAUTHORIZED");
    expect(socket.data.playerId).toBeUndefined();
  });

  test("accepts via handshake.auth.token and sets playerId", async () => {
    const verify = mock(async () => ({ playerId: "player-alice", tokenExp: 9999 }));
    const verifier = buildVerifierStub(verify);
    const { middleware } = buildAdapter(verifier);
    const next = mock();
    const socket: any = {
      handshake: { auth: { token: "tok-abc" } },
      data: {},
    };
    await middleware(socket, next);
    expect(verify).toHaveBeenCalledWith("tok-abc");
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]![0]).toBeUndefined();
    expect(socket.data.playerId).toBe("player-alice");
    expect(socket.data.tokenExp).toBe(9999);
  });

  test("accepts via Bearer authorization header", async () => {
    const verify = mock(async () => ({ playerId: "player-bob", tokenExp: 8888 }));
    const verifier = buildVerifierStub(verify);
    const { middleware } = buildAdapter(verifier);
    const next = mock();
    const socket: any = {
      handshake: { headers: { authorization: "Bearer tok-xyz" } },
      data: {},
    };
    await middleware(socket, next);
    expect(verify).toHaveBeenCalledWith("tok-xyz");
    expect(next.mock.calls[0]![0]).toBeUndefined();
    expect(socket.data.playerId).toBe("player-bob");
  });

  test("ignores handshake.query.token (proxy log safety)", async () => {
    const verify = mock(async () => ({ playerId: "p", tokenExp: 1 }));
    const verifier = buildVerifierStub(verify);
    const { middleware } = buildAdapter(verifier);
    const next = mock();
    const socket: any = {
      handshake: { query: { token: "tok-leak" } },
      data: {},
    };
    await middleware(socket, next);
    expect(verify).not.toHaveBeenCalled();
    const err = next.mock.calls[0]![0] as Error;
    expect(err.message).toBe("UNAUTHORIZED");
    expect(socket.data.playerId).toBeUndefined();
  });

  test("rejects when verifier throws", async () => {
    const verifier = buildVerifierStub(
      mock(async () => {
        throw new Error("INVALID_TOKEN");
      }),
    );
    const { middleware } = buildAdapter(verifier);
    const next = mock();
    const socket: any = {
      handshake: { auth: { token: "tok-bad" } },
      data: {},
    };
    await middleware(socket, next);
    const err = next.mock.calls[0]![0] as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("UNAUTHORIZED");
    expect(socket.data.playerId).toBeUndefined();
  });
});
