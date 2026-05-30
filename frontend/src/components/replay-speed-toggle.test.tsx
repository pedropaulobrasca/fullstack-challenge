import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ReplaySpeedToggle } from "@/components/replay-speed-toggle";

afterEach(() => cleanup());

describe("ReplaySpeedToggle", () => {
  it("renders one item per speed", () => {
    render(
      <ReplaySpeedToggle speeds={[1, 2, 4]} currentSpeed={1} onChange={() => {}} />,
    );
    expect(screen.getByLabelText("Replay at 1x speed")).toBeTruthy();
    expect(screen.getByLabelText("Replay at 2x speed")).toBeTruthy();
    expect(screen.getByLabelText("Replay at 4x speed")).toBeTruthy();
  });

  it("invokes onChange with the numeric speed when an item is clicked", () => {
    const onChange = vi.fn();
    render(
      <ReplaySpeedToggle speeds={[1, 2, 4]} currentSpeed={1} onChange={onChange} />,
    );
    fireEvent.click(screen.getByLabelText("Replay at 2x speed"));
    expect(onChange).toHaveBeenCalledWith(2);
  });
});
