import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  initialFairnessState,
  selectRecentlyVerified,
  selectVerdict,
  useFairnessStore,
} from "./fairness.store";

const RECENT_TTL_MS = 4000;

beforeEach(() => {
  useFairnessStore.setState({ ...initialFairnessState, verdicts: new Map() });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fairness.store", () => {
  it("starts with empty verdicts, no transient, and a closed drawer", () => {
    const state = useFairnessStore.getState();
    expect(state.verdicts.size).toBe(0);
    expect(state.recentlyVerifiedRoundId).toBeNull();
    expect(state.recentlyVerifiedExpiresAt).toBeNull();
    expect(state.drawerOpen).toBe(false);
  });

  it("records a MATCH verdict and arms the transient with a future expiry", () => {
    const before = Date.now();
    useFairnessStore.getState().recordVerdict("r1", "MATCH");
    const state = useFairnessStore.getState();
    expect(selectVerdict(state, "r1")).toBe("MATCH");
    expect(state.recentlyVerifiedRoundId).toBe("r1");
    expect(state.recentlyVerifiedExpiresAt).not.toBeNull();
    expect(state.recentlyVerifiedExpiresAt!).toBeGreaterThanOrEqual(
      before + RECENT_TTL_MS,
    );
  });

  it("records a MISMATCH verdict without touching the transient checkmark", () => {
    useFairnessStore.getState().recordVerdict("r1", "MATCH");
    const armedExpiry = useFairnessStore.getState().recentlyVerifiedExpiresAt;
    useFairnessStore.getState().recordVerdict("r2", "MISMATCH");
    const state = useFairnessStore.getState();
    expect(selectVerdict(state, "r2")).toBe("MISMATCH");
    expect(state.recentlyVerifiedRoundId).toBe("r1");
    expect(state.recentlyVerifiedExpiresAt).toBe(armedExpiry);
  });

  it("selectRecentlyVerified is true right after MATCH and false after TTL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
    useFairnessStore.getState().recordVerdict("r1", "MATCH");
    const justAfter = useFairnessStore.getState();
    expect(selectRecentlyVerified(justAfter, "r1", Date.now())).toBe(true);
    expect(
      selectRecentlyVerified(justAfter, "r1", Date.now() + RECENT_TTL_MS + 1),
    ).toBe(false);
    expect(selectRecentlyVerified(justAfter, "other", Date.now())).toBe(false);
  });

  it("clearRecentlyVerified resets transient without touching the verdicts map", () => {
    useFairnessStore.getState().recordVerdict("r1", "MATCH");
    useFairnessStore.getState().clearRecentlyVerified();
    const state = useFairnessStore.getState();
    expect(state.recentlyVerifiedRoundId).toBeNull();
    expect(state.recentlyVerifiedExpiresAt).toBeNull();
    expect(selectVerdict(state, "r1")).toBe("MATCH");
  });

  it("openDrawer flips drawerOpen to true without disturbing verdicts", () => {
    useFairnessStore.getState().recordVerdict("r1", "MATCH");
    useFairnessStore.getState().openDrawer();
    const state = useFairnessStore.getState();
    expect(state.drawerOpen).toBe(true);
    expect(selectVerdict(state, "r1")).toBe("MATCH");
  });

  it("closeDrawer flips drawerOpen back to false without disturbing verdicts", () => {
    useFairnessStore.getState().recordVerdict("r1", "MATCH");
    useFairnessStore.getState().openDrawer();
    useFairnessStore.getState().closeDrawer();
    const state = useFairnessStore.getState();
    expect(state.drawerOpen).toBe(false);
    expect(selectVerdict(state, "r1")).toBe("MATCH");
  });
});
