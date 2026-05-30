import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  createRootRoute,
  createRouter,
  createMemoryHistory,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";

import { VerifyPage, Route as VerifyRoute } from "@/routes/verify.$roundId";
import type { RecomputeState } from "@/features/verify/use-recompute-crashpoint";

const VALID_UUID = "11111111-2222-3333-4444-555555555555";

function makeState(overrides: Partial<RecomputeState> = {}): RecomputeState {
  return {
    status: "loading",
    verifyResponse: null,
    computedCrashPoint: null,
    computedHmacHex: null,
    computedFirst13Hex: null,
    errorMessage: null,
    retry: vi.fn(),
    ...overrides,
  };
}

const fixtureResponse = {
  roundId: VALID_UUID,
  nonce: "0",
  serverSeed:
    "0000000000000000000000000000000000000000000000000000000000000001",
  serverSeedHash: "ignored",
  clientSeed: "test",
  crashPoint: 2.94,
  formulaVersion: 1,
  previousServerSeed: null,
};

function renderWithRoute(roundId: string, state: RecomputeState) {
  const impl = vi.fn(() => state);
  function ChildPage() {
    return <VerifyPage roundId={roundId} useRecomputeImpl={impl} />;
  }
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const childRoute = (VerifyRoute as unknown as { update: (opts: unknown) => typeof VerifyRoute }).update({
    id: "/verify/$roundId",
    path: "/verify/$roundId",
    getParentRoute: () => rootRoute,
    component: ChildPage,
  });
  const tree = rootRoute.addChildren([childRoute]);
  const router = createRouter({
    routeTree: tree,
    history: createMemoryHistory({
      initialEntries: [`/verify/${roundId}`],
    }),
  });
  const result = render(<RouterProvider router={router} />);
  return { ...result, impl };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("VerifyPage", () => {
  it("renders three cards + MATCH chip with locked copy for the Phase 4 fixture", async () => {
    const state = makeState({
      status: "match",
      verifyResponse: fixtureResponse,
      computedCrashPoint: 2.94,
      computedHmacHex: "a".repeat(64),
      computedFirst13Hex: "a".repeat(13),
    });

    renderWithRoute(VALID_UUID, state);

    expect(await screen.findByText(/Inputs \(from server\)/)).toBeInTheDocument();
    expect(screen.getByText(/Computed in your browser/)).toBeInTheDocument();
    expect(screen.getByText(/Reported by server/)).toBeInTheDocument();
    expect(
      screen.getByText("MATCH · Computed crash point equals reported crash point"),
    ).toBeInTheDocument();
    expect(screen.getByText("bustabit-52bit-instant-101")).toBeInTheDocument();
  });

  it("renders MISMATCH chip with assertive aria-live for tampered response", async () => {
    const state = makeState({
      status: "mismatch",
      verifyResponse: { ...fixtureResponse, crashPoint: 3.5 },
      computedCrashPoint: 2.94,
      computedHmacHex: "b".repeat(64),
      computedFirst13Hex: "b".repeat(13),
    });

    renderWithRoute(VALID_UUID, state);

    const chip = await screen.findByText(
      "MISMATCH · Computed crash point differs from reported",
    );
    expect(chip).toBeInTheDocument();
    const chipRegion = chip.closest('[data-slot="verdict-chip"]');
    expect(chipRegion?.getAttribute("aria-live")).toBe("assertive");
  });

  it("renders the locked not-settled Alert with Refresh + Go-to-live-game CTAs", async () => {
    const state = makeState({ status: "not-settled" });
    renderWithRoute(VALID_UUID, state);

    expect(
      await screen.findByText(
        "This round has not crashed yet. The serverSeed will be revealed automatically after it settles.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /go to live game/i })).toBeInTheDocument();
  });

  it("renders the destructive not-found Alert with back-to-game button", async () => {
    const state = makeState({ status: "not-found" });
    renderWithRoute(VALID_UUID, state);

    expect(await screen.findByText(/not found\./i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to live game/i })).toBeInTheDocument();
  });

  it("short-circuits to not-found WITHOUT firing the fetch for an invalid roundId", async () => {
    const state = makeState({ status: "idle" });
    const { impl } = renderWithRoute("not-a-uuid", state);

    expect(await screen.findByText(/not found\./i)).toBeInTheDocument();
    // The hook is called with null (param invalid) — it should never receive a non-uuid value
    for (const call of impl.mock.calls) {
      expect((call as unknown as [string | null])[0]).toBeNull();
    }
  });

  it("renders the locked verification explainer paragraph", async () => {
    const state = makeState({
      status: "match",
      verifyResponse: fixtureResponse,
      computedCrashPoint: 2.94,
      computedHmacHex: "c".repeat(64),
      computedFirst13Hex: "c".repeat(13),
    });
    renderWithRoute(VALID_UUID, state);

    expect(
      await screen.findByText(
        /Before each round, the server publishes a SHA-256 hash of a secret seed/i,
      ),
    ).toBeInTheDocument();
  });
});
