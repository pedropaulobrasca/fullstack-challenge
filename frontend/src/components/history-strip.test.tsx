import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";

vi.mock("@/lib/config", () => ({
  getConfig: () => ({
    history: { redMaxX: 1.5, yellowMaxX: 2.0 },
    replay: { speeds: [1, 2, 4], autostart: true },
    historySize: 20,
  }),
}));

import { HistoryStrip } from "@/components/history-strip";
import { useHistoryStore } from "@/stores/history.store";
import {
  initialReplayState,
  useReplayStore,
} from "@/features/replay/replay.store";

beforeEach(() => {
  useHistoryStore.setState({ entries: [] });
  useReplayStore.setState({ ...initialReplayState });
});

afterEach(() => {
  cleanup();
  useHistoryStore.setState({ entries: [] });
  useReplayStore.setState({ ...initialReplayState });
});

describe("HistoryStrip", () => {
  it("renders an empty-state copy when no rounds have settled", () => {
    render(<HistoryStrip />);
    expect(screen.getByText("No rounds yet")).toBeInTheDocument();
  });

  it("renders one chip per history entry with crash-point label", () => {
    useHistoryStore.setState({
      entries: [
        { roundId: "11111111-aaaa-aaaa-aaaa-111111111111", crashPoint: 2.41 },
        { roundId: "22222222-bbbb-bbbb-bbbb-222222222222", crashPoint: 1.05 },
      ],
    });
    render(<HistoryStrip />);
    expect(screen.getByText("2.41x")).toBeInTheDocument();
    expect(screen.getByText("1.05x")).toBeInTheDocument();
  });

  it("clicking a chip calls openReplay with the chip's roundId, config autostart, and first speed", () => {
    useHistoryStore.setState({
      entries: [
        { roundId: "11111111-aaaa-aaaa-aaaa-111111111111", crashPoint: 2.41 },
      ],
    });
    const openReplaySpy = vi.spyOn(useReplayStore.getState(), "openReplay");
    render(<HistoryStrip />);
    fireEvent.click(screen.getByText("2.41x").closest("button")!);
    expect(openReplaySpy).toHaveBeenCalledWith(
      "11111111-aaaa-aaaa-aaaa-111111111111",
      true,
      1,
    );
  });

  it("each chip has aria-label naming the round id + crash point", () => {
    useHistoryStore.setState({
      entries: [
        { roundId: "11111111-aaaa-aaaa-aaaa-111111111111", crashPoint: 2.41 },
      ],
    });
    render(<HistoryStrip />);
    expect(
      screen.getByLabelText("Replay Round #11111111, crashed at 2.41x"),
    ).toBeInTheDocument();
  });

  it("renders the lucide History icon inside each chip", () => {
    useHistoryStore.setState({
      entries: [
        { roundId: "11111111-aaaa-aaaa-aaaa-111111111111", crashPoint: 2.41 },
      ],
    });
    render(<HistoryStrip />);
    const chip = screen.getByText("2.41x").closest("button");
    expect(chip).toBeTruthy();
    expect(chip!.querySelector("svg")).not.toBeNull();
  });
});
