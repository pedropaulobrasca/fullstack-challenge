import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { VerificationDrawer } from "@/components/verification-drawer";
import { useRoundStore } from "@/stores/round.store";
import { useHistoryStore } from "@/stores/history.store";
import {
  initialFairnessState,
  useFairnessStore,
} from "@/features/fairness/fairness.store";
import type { VerifyPreviousState } from "@/features/fairness/use-verify-previous";

beforeEach(() => {
  useRoundStore.setState({
    roundId: "round-current",
    status: "BETTING",
    bettingEndsAt: null,
    roundStartedAt: null,
    crashValue: null,
  });
  useHistoryStore.setState({
    entries: [{ roundId: "round-prev", crashPoint: 2.41 }],
  });
  useFairnessStore.setState({ ...initialFairnessState, verdicts: new Map() });
});

afterEach(() => {
  useFairnessStore.setState({ ...initialFairnessState, verdicts: new Map() });
});

const baseState: VerifyPreviousState = {
  status: "idle",
  computedHash: null,
  previousRoundId: "round-prev",
  previousServerSeed: null,
  previousSeedHash: null,
  errorMessage: null,
  errorCode: null,
  retry: () => {},
};

function makeStub(state: Partial<VerifyPreviousState>) {
  return () => ({ ...baseState, ...state });
}

describe("VerificationDrawer", () => {
  it("does not render a dialog when drawerOpen=false", () => {
    render(
      <VerificationDrawer useVerifyPreviousImpl={makeStub({ status: "match" })} />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders dialog with locked SheetTitle + SheetDescription when open", () => {
    useFairnessStore.setState({ drawerOpen: true });
    render(
      <VerificationDrawer useVerifyPreviousImpl={makeStub({ status: "match" })} />,
    );
    expect(screen.getByText("Fairness verification")).toBeInTheDocument();
    expect(
      screen.getByText("Hashed in your browser. No server trust required."),
    ).toBeInTheDocument();
  });

  it("renders three HashBlocks plus a MATCH chip with role=status when match", () => {
    useFairnessStore.setState({ drawerOpen: true });
    render(
      <VerificationDrawer
        useVerifyPreviousImpl={makeStub({
          status: "match",
          previousServerSeed: "ff10",
          computedHash: "a3f8",
        })}
      />,
    );
    const blocks = document.querySelectorAll('[data-slot="hash-block"]');
    expect(blocks.length).toBe(3);
    const matchChip = screen.getByText("MATCH · Previous commitment confirmed");
    expect(matchChip.closest("[role='status']")).not.toBeNull();
  });

  it("renders a MISMATCH chip with role=status and aria-live=assertive", () => {
    useFairnessStore.setState({ drawerOpen: true });
    render(
      <VerificationDrawer
        useVerifyPreviousImpl={makeStub({
          status: "mismatch",
          previousServerSeed: "ff10",
          computedHash: "0000",
        })}
      />,
    );
    const chip = screen
      .getByText("MISMATCH · Commitment differs from revealed seed")
      .closest("[role='status']");
    expect(chip).not.toBeNull();
    expect(chip).toHaveAttribute("aria-live", "assertive");
  });

  it("renders ROUND_NOT_YET_SETTLED locked copy + Retry button calling retry()", () => {
    useFairnessStore.setState({ drawerOpen: true });
    const retrySpy = vi.fn();
    render(
      <VerificationDrawer
        useVerifyPreviousImpl={makeStub({
          status: "error",
          errorCode: "ROUND_NOT_YET_SETTLED",
          errorMessage:
            "The previous round is still settling. Try again in a moment.",
          retry: retrySpy,
        })}
      />,
    );
    expect(
      screen.getByText(
        "The previous round is still settling. Try again in a moment.",
      ),
    ).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Retry" });
    act(() => {
      fireEvent.click(retry);
    });
    expect(retrySpy).toHaveBeenCalledTimes(1);
  });
});
