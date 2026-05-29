import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", () => ({
  getConfig: vi.fn(() => ({
    history: { redMaxX: 1.5, yellowMaxX: 2.0 },
  })),
}));

import { classifyBand } from "@/features/history/history-band";
import { getConfig } from "@/lib/config";

const mockThresholds = (redMaxX: number, yellowMaxX: number) => {
  vi.mocked(getConfig).mockReturnValue({
    history: { redMaxX, yellowMaxX },
  } as ReturnType<typeof getConfig>);
};

describe("classifyBand", () => {
  it("classifies a crash point below the red threshold as low", () => {
    mockThresholds(1.5, 2.0);
    expect(classifyBand(1.04)).toBe("low");
  });

  it("treats the red threshold as inclusive (low)", () => {
    mockThresholds(1.5, 2.0);
    expect(classifyBand(1.5)).toBe("low");
  });

  it("classifies a crash point between the thresholds as mid", () => {
    mockThresholds(1.5, 2.0);
    expect(classifyBand(1.8)).toBe("mid");
  });

  it("treats the yellow threshold as inclusive (mid)", () => {
    mockThresholds(1.5, 2.0);
    expect(classifyBand(2.0)).toBe("mid");
  });

  it("classifies a crash point above the yellow threshold as high", () => {
    mockThresholds(1.5, 2.0);
    expect(classifyBand(3.2)).toBe("high");
  });

  it("reads thresholds from config so changing them moves the boundary", () => {
    mockThresholds(3.0, 5.0);
    expect(classifyBand(2.5)).toBe("low");
    expect(classifyBand(4.0)).toBe("mid");
    expect(classifyBand(6.0)).toBe("high");
  });
});
