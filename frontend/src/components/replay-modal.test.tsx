import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";

import { ReplayModal } from "@/components/replay-modal";
import {
  initialReplayState,
  useReplayStore,
} from "@/features/replay/replay.store";
import type { RoundDetail } from "@/features/replay/use-round-detail";

const ROUND_FIXTURE: RoundDetail = {
  roundId: "11111111-1111-1111-1111-111111111246",
  nonce: "0",
  serverSeed:
    "0000000000000000000000000000000000000000000000000000000000000001",
  serverSeedHash: "abc",
  clientSeed: "test",
  crashPoint: 2.94,
  recomputedCrashPoint: 2.94,
  matches: true,
  formulaVersion: 1,
  previousServerSeed: null,
  bets: [
    {
      betId: "bet-1",
      playerIdMasked: "ab12cd34",
      amount: { amount: "500", currency: "CRD", scale: 2 },
      status: "CASHED_OUT",
      cashedOutMultiplier: 1.5,
      payout: { amount: "750", currency: "CRD", scale: 2 },
    },
  ],
  growthRate: 0.06,
};

type StubQuery = {
  data?: RoundDetail;
  isLoading: boolean;
  isError: boolean;
  error: null;
  refetch: () => void;
};

function makeStub(query: StubQuery) {
  return () => query as unknown as ReturnType<typeof import("@/features/replay/use-round-detail").useRoundDetail>;
}

beforeEach(() => {
  useReplayStore.setState({ ...initialReplayState });

  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    setTransform: () => {},
    clearRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fillText: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    font: "",
    textAlign: "",
    textBaseline: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineJoin: "",
    lineCap: "",
    shadowBlur: 0,
    shadowColor: "",
  })) as never;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useReplayStore.setState({ ...initialReplayState });
});

describe("ReplayModal", () => {
  it("renders nothing when roundId is null", () => {
    render(<ReplayModal useRoundDetailImpl={makeStub({
      isLoading: false,
      isError: false,
      error: null,
      refetch: () => {},
    })} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders DialogTitle with the locked Replay prefix and the exact DialogDescription", () => {
    useReplayStore.getState().openReplay(ROUND_FIXTURE.roundId, true, 1);
    render(
      <ReplayModal
        useRoundDetailImpl={makeStub({
          data: ROUND_FIXTURE,
          isLoading: false,
          isError: false,
          error: null,
          refetch: () => {},
        })}
      />,
    );
    expect(screen.getByText(/Replay · Round #/)).toBeInTheDocument();
    expect(
      screen.getByText(
        "Reproduced from serverSeed + clientSeed + bets[]. Same renderer as the live game.",
      ),
    ).toBeInTheDocument();
  });

  it("autostarts in playing state and renders a Pause button when openReplay(autostart=true)", () => {
    useReplayStore.getState().openReplay(ROUND_FIXTURE.roundId, true, 1);
    render(
      <ReplayModal
        useRoundDetailImpl={makeStub({
          data: ROUND_FIXTURE,
          isLoading: false,
          isError: false,
          error: null,
          refetch: () => {},
        })}
      />,
    );
    expect(useReplayStore.getState().playing).toBe(true);
    const pause = screen.getByRole("button", { name: "Pause replay" });
    expect(pause).toBeTruthy();
  });

  it("invokes setSpeed(2) when the 2x toggle item is clicked", () => {
    useReplayStore.getState().openReplay(ROUND_FIXTURE.roundId, true, 1);
    render(
      <ReplayModal
        useRoundDetailImpl={makeStub({
          data: ROUND_FIXTURE,
          isLoading: false,
          isError: false,
          error: null,
          refetch: () => {},
        })}
      />,
    );
    fireEvent.click(screen.getByLabelText("Replay at 2x speed"));
    expect(useReplayStore.getState().speed).toBe(2);
  });

  it("renders an inline destructive Alert (not a sonner toast) when round detail errors", () => {
    useReplayStore.getState().openReplay(ROUND_FIXTURE.roundId, true, 1);
    render(
      <ReplayModal
        useRoundDetailImpl={makeStub({
          isLoading: false,
          isError: true,
          error: null,
          refetch: () => {},
        })}
      />,
    );
    expect(
      screen.getByText(/Couldn't load replay data for Round #/),
    ).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toBeTruthy();
    expect(document.querySelector("[data-sonner-toaster]")).toBeNull();
  });

  it("renders a Play button when openReplay(autostart=false); clicking it sets playing=true", () => {
    useReplayStore.getState().openReplay(ROUND_FIXTURE.roundId, false, 1);
    render(
      <ReplayModal
        useRoundDetailImpl={makeStub({
          data: ROUND_FIXTURE,
          isLoading: false,
          isError: false,
          error: null,
          refetch: () => {},
        })}
      />,
    );
    const play = screen.getByRole("button", { name: "Play replay" });
    fireEvent.click(play);
    expect(useReplayStore.getState().playing).toBe(true);
  });
});
