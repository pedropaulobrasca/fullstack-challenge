import { describe, expect, it, vi, beforeEach } from "vitest";

const enforceLoginMock = vi.fn();
const getOidcMock = vi.fn();
const ioMock = vi.fn(() => ({ disconnect: vi.fn() }));

vi.mock("@/auth/oidc", () => ({
  enforceLogin: enforceLoginMock,
  getOidc: getOidcMock,
  useOidc: vi.fn(),
  OidcInitializationGate: vi.fn(),
  bootstrapAuth: vi.fn(),
}));

vi.mock("socket.io-client", () => ({
  io: ioMock,
}));

vi.mock("@/lib/config", () => ({
  getConfig: () => ({
    ws: { url: "http://localhost:8000" },
    rest: { base: "http://localhost:8000" },
    keycloak: { issuer: "http://localhost:8080/realms/crash-game", clientId: "crash-game-client" },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  ioMock.mockReturnValue({ disconnect: vi.fn() } as never);
});

describe("game route auth guard", () => {
  it("uses enforceLogin as the route beforeLoad guard", async () => {
    const { Route } = await import("@/routes/index");
    expect(Route.options.beforeLoad).toBe(enforceLoginMock);
  });

  it("redirects (never resolves to a logged-in route) when the user is not logged in", async () => {
    enforceLoginMock.mockImplementation(() => {
      throw new Error("redirect-to-keycloak");
    });
    expect(() => enforceLoginMock({ location: { href: "/" } })).toThrow(
      "redirect-to-keycloak",
    );
  });
});

describe("socket.io auth function", () => {
  it("resolves the bearer token from getOidc().getAccessToken() (function form, not cached)", async () => {
    let currentToken = "token-1";
    getOidcMock.mockImplementation(() =>
      Promise.resolve({
        isUserLoggedIn: true,
        getAccessToken: () => Promise.resolve(currentToken),
      }),
    );

    const { getSocket } = await import("@/ws/socket");
    getSocket();

    expect(ioMock).toHaveBeenCalledTimes(1);
    const [, options] = ioMock.mock.calls[0] as unknown as [
      string,
      { auth: (cb: (data: unknown) => void) => void; path: string; transports: string[] },
    ];
    expect(options.path).toBe("/ws");
    expect(options.transports).toEqual(["websocket"]);
    expect(typeof options.auth).toBe("function");

    const firstCb = vi.fn();
    options.auth(firstCb);
    await vi.waitFor(() => expect(firstCb).toHaveBeenCalledWith({ token: "token-1" }));

    currentToken = "token-2";
    const secondCb = vi.fn();
    options.auth(secondCb);
    await vi.waitFor(() => expect(secondCb).toHaveBeenCalledWith({ token: "token-2" }));
  });

  it("passes no token when the user is not logged in", async () => {
    getOidcMock.mockImplementation(() =>
      Promise.resolve({ isUserLoggedIn: false }),
    );

    vi.resetModules();
    const { getSocket } = await import("@/ws/socket");
    getSocket();

    const [, options] = ioMock.mock.calls[0] as unknown as [
      string,
      { auth: (cb: (data: unknown) => void) => void },
    ];
    const cb = vi.fn();
    options.auth(cb);
    await vi.waitFor(() => expect(cb).toHaveBeenCalledWith({}));
  });
});
