import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  createRootRoute,
  createRouter,
  createMemoryHistory,
  createRoute,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";

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

function renderDrawer(stub: () => VerifyPreviousState) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const homeRoute = createRoute({
    path: "/",
    getParentRoute: () => rootRoute,
    component: () => <VerificationDrawer useVerifyPreviousImpl={stub} />,
  });
  const verifyRoute = createRoute({
    path: "/verify/$roundId",
    getParentRoute: () => rootRoute,
    component: () => null,
  });
  const tree = rootRoute.addChildren([homeRoute, verifyRoute]);
  const router = createRouter({
    routeTree: tree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(<RouterProvider router={router} />);
}

describe("VerificationDrawer", () => {
  it("does not render a dialog when drawerOpen=false", () => {
    renderDrawer(makeStub({ status: "match" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders dialog with locked SheetTitle + SheetDescription when open", async () => {
    useFairnessStore.setState({ drawerOpen: true });
    renderDrawer(makeStub({ status: "match" }));
    expect(await screen.findByText("Fairness verification")).toBeInTheDocument();
    expect(
      screen.getByText("Hashed in your browser. No server trust required."),
    ).toBeInTheDocument();
  });

  it("renders three HashBlocks plus a MATCH chip with role=status when match", async () => {
    useFairnessStore.setState({ drawerOpen: true });
    renderDrawer(
      makeStub({
        status: "match",
        previousServerSeed: "ff10",
        computedHash: "a3f8",
      }),
    );
    await screen.findByText("Fairness verification");
    const blocks = document.querySelectorAll('[data-slot="hash-block"]');
    expect(blocks.length).toBe(3);
    const matchChip = screen.getByText("MATCH · Previous commitment confirmed");
    expect(matchChip.closest("[role='status']")).not.toBeNull();
  });

  it("renders a MISMATCH chip with role=status and aria-live=assertive", async () => {
    useFairnessStore.setState({ drawerOpen: true });
    renderDrawer(
      makeStub({
        status: "mismatch",
        previousServerSeed: "ff10",
        computedHash: "0000",
      }),
    );
    const chip = (
      await screen.findByText("MISMATCH · Commitment differs from revealed seed")
    ).closest("[role='status']");
    expect(chip).not.toBeNull();
    expect(chip).toHaveAttribute("aria-live", "assertive");
  });

  it("renders ROUND_NOT_YET_SETTLED locked copy + Retry button calling retry()", async () => {
    useFairnessStore.setState({ drawerOpen: true });
    const retrySpy = vi.fn();
    renderDrawer(
      makeStub({
        status: "error",
        errorCode: "ROUND_NOT_YET_SETTLED",
        errorMessage:
          "The previous round is still settling. Try again in a moment.",
        retry: retrySpy,
      }),
    );
    expect(
      await screen.findByText(
        "The previous round is still settling. Try again in a moment.",
      ),
    ).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Retry" });
    act(() => {
      fireEvent.click(retry);
    });
    expect(retrySpy).toHaveBeenCalledTimes(1);
  });

  it("renders typed <Link to=/verify/$roundId> for Open full verification", async () => {
    useFairnessStore.setState({ drawerOpen: true });
    renderDrawer(makeStub({ status: "match" }));
    const link = await screen.findByRole("link", {
      name: /Open full verification/i,
    });
    expect(link).toHaveAttribute("href", "/verify/round-prev");
  });
});
