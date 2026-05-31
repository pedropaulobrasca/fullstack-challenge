import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("@/lib/config", () => ({
  getConfig: () => ({
    ewmaAlpha: 0.1,
    feedBufferSize: 3,
    historySize: 20,
  }),
}));

import { dispatchWsEvent } from "@/stores/ws-dispatch";
import { useRoundStore } from "@/stores/round.store";
import { useMultiplierStore } from "@/stores/multiplier.store";
import { useWalletStore } from "@/stores/wallet.store";
import { useFeedStore } from "@/stores/feed.store";
import { useBetStore } from "@/stores/bet.store";
import { useHistoryStore } from "@/stores/history.store";

const moneySnap = (amount: string) => ({ amount, currency: "CRD", scale: 2 });

beforeEach(() => {
  useRoundStore.setState({
    roundId: null,
    status: "IDLE",
    bettingEndsAt: null,
    roundStartedAt: null,
    crashValue: null,
  });
  useMultiplierStore.getState().reset();
  useWalletStore.setState({ balance: null });
  useFeedStore.setState({ entries: [] });
  useBetStore.setState({ myBet: null, pending: false, celebrate: false });
  useHistoryStore.setState({ entries: [] });
});

describe("round:tick (isolated multiplier store, D-06)", () => {
  it("updates serverOffsetMs via EWMA and never mutates other stores", () => {
    const roundBefore = useRoundStore.getState();
    const feedBefore = useFeedStore.getState().entries;
    const betBefore = useBetStore.getState().myBet;
    const walletBefore = useWalletStore.getState().balance;

    const now = 10_000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    dispatchWsEvent("round:tick", { roundId: "r1", multiplier: 1.5, t: now + 200 });

    const mult = useMultiplierStore.getState();
    expect(mult.serverOffsetMs).toBe(200);
    expect(mult.reconcileTarget).toBe(1.5);

    expect(useRoundStore.getState().status).toBe(roundBefore.status);
    expect(useRoundStore.getState().crashValue).toBe(roundBefore.crashValue);
    expect(useFeedStore.getState().entries).toBe(feedBefore);
    expect(useBetStore.getState().myBet).toBe(betBefore);
    expect(useWalletStore.getState().balance).toBe(walletBefore);

    vi.restoreAllMocks();
  });

  it("tweens toward the target over two ticks (never snaps for alpha < 1)", () => {
    const now = 50_000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    dispatchWsEvent("round:tick", { roundId: "r1", multiplier: 1.2, t: now });
    expect(useMultiplierStore.getState().serverOffsetMs).toBe(0);

    dispatchWsEvent("round:tick", { roundId: "r1", multiplier: 1.3, t: now + 1000 });
    const offset = useMultiplierStore.getState().serverOffsetMs;
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThan(1000);
    expect(offset).toBeCloseTo(100, 5);

    vi.restoreAllMocks();
  });
});

describe("round:crashed", () => {
  it("freezes crashValue from the server crashPoint and prepends to history", () => {
    dispatchWsEvent("round:crashed", {
      roundId: "r9",
      crashPoint: 3.41,
      crashedAt: "2026-05-28T00:00:00.000Z",
    });
    expect(useRoundStore.getState().status).toBe("CRASHED");
    expect(useRoundStore.getState().crashValue).toBe(3.41);
    expect(useHistoryStore.getState().entries[0]).toEqual({
      roundId: "r9",
      crashPoint: 3.41,
    });
  });

  it("does not duplicate a history entry when a non-head round re-crashes (stable keys)", () => {
    useHistoryStore.setState({
      entries: [
        { roundId: "r-head", crashPoint: 3.0 },
        { roundId: "r-dup", crashPoint: 2.0 },
      ],
    });

    dispatchWsEvent("round:crashed", {
      roundId: "r-dup",
      crashPoint: 2.0,
      crashedAt: "2026-05-28T00:00:00.000Z",
    });

    const ids = useHistoryStore.getState().entries.map((e) => e.roundId);
    expect(ids.filter((id) => id === "r-dup")).toHaveLength(1);
  });
});

describe("feed circular buffer", () => {
  it("caps at the configured size and marks own actions", () => {
    useBetStore.setState({
      myBet: {
        betId: "mine",
        roundId: "r1",
        amount: moneySnap("100"),
        status: "ACTIVE",
        cashoutMultiplier: null,
      },
      pending: false,
      celebrate: false,
    });

    for (let i = 0; i < 5; i += 1) {
      dispatchWsEvent("bet:placed", {
        roundId: "r1",
        betId: `bet-${i}`,
        playerIdMasked: "0a1b2c3d",
        amount: moneySnap("250"),
      });
    }
    dispatchWsEvent("bet:placed", {
      roundId: "r1",
      betId: "mine",
      playerIdMasked: "0a1b2c3d",
      amount: moneySnap("100"),
    });

    const entries = useFeedStore.getState().entries;
    expect(entries).toHaveLength(3);
    expect(entries[0]?.betId).toBe("mine");
    expect(entries[0]?.isOwn).toBe(true);
    expect(entries[1]?.isOwn).toBe(false);
  });
});

describe("invalid payload handling", () => {
  it("drops a payload that fails schema.parse and leaves stores untouched", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const roundBefore = useRoundStore.getState().status;

    dispatchWsEvent("round:crashed", { roundId: "r1", crashPoint: -5 });

    expect(useRoundStore.getState().status).toBe(roundBefore);
    expect(useHistoryStore.getState().entries).toHaveLength(0);
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });
});

describe("round:snapshot null payload (D-03b, reconnect between rounds)", () => {
  it("treats null payload as a silent no-op (no throw, no warn, no store mutation)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const roundBefore = useRoundStore.getState();
    const betBefore = useBetStore.getState().myBet;
    const multBefore = useMultiplierStore.getState();

    expect(() => dispatchWsEvent("round:snapshot", null)).not.toThrow();

    expect(warn).not.toHaveBeenCalled();
    expect(useRoundStore.getState().roundId).toBe(roundBefore.roundId);
    expect(useRoundStore.getState().status).toBe(roundBefore.status);
    expect(useBetStore.getState().myBet).toBe(betBefore);
    expect(useMultiplierStore.getState().serverOffsetMs).toBe(multBefore.serverOffsetMs);

    warn.mockRestore();
  });
});

describe("round:settled clears a lost bet", () => {
  const settledPayload = {
    roundId: "r1",
    serverSeed: "seed-r1",
    settledAt: "2026-05-28T00:00:00.000Z",
  };

  it("clears an ACTIVE bet belonging to the settled round so Place Bet re-enables", () => {
    useBetStore.setState({
      myBet: {
        betId: "mine",
        roundId: "r1",
        amount: moneySnap("100"),
        status: "ACTIVE",
        cashoutMultiplier: null,
      },
      pending: false,
      celebrate: false,
    });

    dispatchWsEvent("round:settled", settledPayload);

    expect(useBetStore.getState().myBet).toBeNull();
  });

  it("clears a cashed-out bet on round:settled but preserves lastOutcome", () => {
    useBetStore.setState({
      myBet: {
        betId: "mine",
        roundId: "r1",
        amount: moneySnap("100"),
        status: "CASHED_OUT",
        cashoutMultiplier: 2.5,
      },
      lastOutcome: "CASHED_OUT",
      pending: false,
      celebrate: false,
    });

    dispatchWsEvent("round:settled", settledPayload);

    expect(useBetStore.getState().myBet).toBeNull();
    expect(useBetStore.getState().lastOutcome).toBe("CASHED_OUT");
  });

  it("does not clear a freshly-placed bet for a different (next) round", () => {
    useBetStore.setState({
      myBet: {
        betId: "next",
        roundId: "r2",
        amount: moneySnap("100"),
        status: "ACTIVE",
        cashoutMultiplier: null,
      },
      pending: false,
      celebrate: false,
    });

    dispatchWsEvent("round:settled", settledPayload);

    expect(useBetStore.getState().myBet?.betId).toBe("next");
  });
});

describe("bet:my_cashed_out", () => {
  it("flags a celebration and credits the wallet from the payout snapshot", () => {
    useWalletStore.setState({ balance: moneySnap("60000") });
    useBetStore.setState({
      myBet: {
        betId: "mine",
        roundId: "r1",
        amount: moneySnap("100"),
        status: "ACTIVE",
        cashoutMultiplier: null,
      },
      pending: false,
      celebrate: false,
    });

    dispatchWsEvent("bet:my_cashed_out", {
      roundId: "r1",
      betId: "mine",
      multiplier: 2.5,
      payout: moneySnap("250"),
    });

    expect(useBetStore.getState().celebrate).toBe(true);
    expect(useBetStore.getState().myBet?.status).toBe("CASHED_OUT");
    expect(useWalletStore.getState().balance?.amount).toBe("60250");
  });
});
