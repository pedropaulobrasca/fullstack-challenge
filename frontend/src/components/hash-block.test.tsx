import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { HashBlock } from "@/components/hash-block";

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const HASH_VALUE =
  "a3f8d22be9c0117f4c84a6b62a8f0a311b32f1d6d2c5c4d3e4f5a6b7c8d92e10";

describe("HashBlock", () => {
  it("renders the value as text content of a <code> element", () => {
    render(<HashBlock label="commitment hash" value={HASH_VALUE} />);
    const code = screen.getByText(HASH_VALUE);
    expect(code.tagName).toBe("CODE");
  });

  it("copies the value to clipboard when Copy is clicked", async () => {
    render(<HashBlock label="commitment hash" value={HASH_VALUE} />);
    const button = screen.getByRole("button", { name: /copy commitment hash/i });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(HASH_VALUE);
  });

  it("shows 'Copied' after click and reverts after 1.4s", async () => {
    vi.useFakeTimers();
    render(<HashBlock label="commitment hash" value={HASH_VALUE} />);
    const button = screen.getByRole("button", { name: /copy commitment hash/i });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(screen.getByText("Copied")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1400);
    });
    expect(screen.queryByText("Copied")).toBeNull();
  });

  it("has aria-label `Copy <label>`", () => {
    render(<HashBlock label="revealed server seed" value={HASH_VALUE} />);
    expect(
      screen.getByRole("button", { name: "Copy revealed server seed" }),
    ).toBeInTheDocument();
  });
});
