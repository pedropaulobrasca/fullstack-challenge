// SC1 disconnect-safety E2E — proves server-enforced auto-cashout per REQ-AUTO-01
// + ROADMAP Phase 9 success criterion 1. Drops the WS client at multiplier >= 1.5x
// with target = 2.0x; asserts CASHED_OUT at 2.0x via REST poll. Requires the live
// docker stack (`bun run docker:up`) and `INTEGRATION=1`.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { setupIntegrationEnv, fetchPlayerToken } from "../integration/_helpers/test-env";

setupIntegrationEnv();

if (process.env.INTEGRATION !== "1") {
  console.log("skipping e2e suite — set INTEGRATION=1");
  process.exit(0);
}

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { io as ioClient, type Socket } from "socket.io-client";

const KONG_BASE = process.env.KONG_BASE_URL ?? "http://localhost:8000";
const WS_BASE = process.env.WS_BASE_URL ?? "ws://localhost:4101";
const WS_PATH = process.env.WS_PATH ?? "/ws";

const TARGET = 2.0;
const DISCONNECT_AT = 1.5;
const POLL_BUDGET_MS = 30_000;
const POLL_INTERVAL_MS = 500;
const MAX_ROUND_ATTEMPTS = 3;

type BetView = {
  betId: string;
  status: string;
  cashedOutMultiplier: number | null;
  amountCents: string;
  autoCashoutTarget: number | null;
};

let playerToken: string;
let playerId: string;

async function provisionWallet(token: string): Promise<void> {
  const res = await fetch(`${KONG_BASE}/wallets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`wallet provision failed: ${res.status} ${await res.text()}`);
  }
}

async function placeBetWithTarget(
  token: string,
  amountCents: string,
  autoCashoutTarget: number,
): Promise<string> {
  const res = await fetch(`${KONG_BASE}/games/bet`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amountCents, autoCashoutTarget }),
  });
  if (res.status !== 202) {
    throw new Error(`placeBet failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { betId: string };
  return body.betId;
}

async function fetchPlayerBet(token: string, betId: string): Promise<BetView | null> {
  const res = await fetch(`${KONG_BASE}/games/bets/me?limit=50&offset=0`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200) {
    return null;
  }
  const body = (await res.json()) as { bets: BetView[] };
  return body.bets.find((b) => b.betId === betId) ?? null;
}

function connectWs(token: string): Socket {
  const socket = ioClient(WS_BASE, {
    path: WS_PATH,
    transports: ["websocket"],
    autoConnect: false,
    reconnection: false,
    forceNew: true,
    auth: { token },
  } as never);
  socket.connect();
  return socket;
}

function waitForEvent<T>(socket: Socket, event: string, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for ${event} after ${timeoutMs}ms`));
    }, timeoutMs);
    const handler = (payload: T): void => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(event, handler);
  });
}

type RoundOutcome = {
  status: string;
  cashedOutMultiplier: number | null;
  crashedAtMultiplier: number | null;
};

async function runOneRound(): Promise<RoundOutcome | null> {
  const socket = connectWs(playerToken);
  let crashedAtMultiplier: number | null = null;
  let disconnectFired = false;

  try {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("ws connect timeout")), 10_000);
      socket.once("connect", () => {
        clearTimeout(t);
        resolve();
      });
      socket.once("connect_error", (err: Error) => {
        clearTimeout(t);
        reject(err);
      });
    });

    await waitForEvent<unknown>(socket, "round:running", 30_000);

    const betId = await placeBetWithTarget(playerToken, "1000", TARGET);

    socket.on("round:tick", (payload: { multiplier: number }) => {
      if (!disconnectFired && payload.multiplier >= DISCONNECT_AT) {
        disconnectFired = true;
        socket.disconnect();
      }
    });

    socket.on("round:crashed", (payload: { crashPoint: number }) => {
      crashedAtMultiplier = payload.crashPoint;
    });

    const start = Date.now();
    while (Date.now() - start < POLL_BUDGET_MS) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const bet = await fetchPlayerBet(playerToken, betId);
      if (bet === null) continue;
      if (bet.status === "CASHED_OUT" || bet.status === "LOST") {
        return {
          status: bet.status,
          cashedOutMultiplier: bet.cashedOutMultiplier,
          crashedAtMultiplier,
        };
      }
    }
    return null;
  } finally {
    if (socket.connected) socket.disconnect();
    socket.close();
  }
}

describe("auto-cashout disconnect-safety E2E (REQ-AUTO-01 / SC1)", () => {
  beforeAll(async () => {
    playerToken = await fetchPlayerToken();
    const claims = JSON.parse(
      Buffer.from(playerToken.split(".")[1]!, "base64").toString("utf-8"),
    );
    playerId = claims.sub as string;
    await provisionWallet(playerToken);
  }, 60_000);

  afterAll(async () => {
    // No-op — sockets cleaned in runOneRound finally blocks.
  });

  test(
    "WS client dropped at multiplier=1.5x with target=2.0x → bet CASHED_OUT at 2.0x server-side",
    async () => {
      let lastOutcome: RoundOutcome | null = null;

      for (let attempt = 1; attempt <= MAX_ROUND_ATTEMPTS; attempt++) {
        const outcome = await runOneRound();
        if (outcome === null) {
          console.log(`attempt ${attempt}: bet did not terminate within budget — retrying`);
          continue;
        }
        lastOutcome = outcome;
        if (outcome.status === "CASHED_OUT") {
          expect(outcome.cashedOutMultiplier).toBeCloseTo(TARGET, 2);
          console.log(
            `SC1 PROOF: bet CASHED_OUT at ${outcome.cashedOutMultiplier}x (target=${TARGET}x), player=${playerId}`,
          );
          return;
        }
        if (outcome.status === "LOST" && outcome.crashedAtMultiplier !== null) {
          console.log(
            `attempt ${attempt}: round crashed at ${outcome.crashedAtMultiplier}x (below target=${TARGET}x) — flaky-seed retry`,
          );
          continue;
        }
      }

      throw new Error(
        `SC1 not proven within ${MAX_ROUND_ATTEMPTS} attempts; last outcome=${JSON.stringify(lastOutcome)}`,
      );
    },
    300_000,
  );
});
