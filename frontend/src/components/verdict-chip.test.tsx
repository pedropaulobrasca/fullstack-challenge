import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { VerdictChip } from "@/components/verdict-chip";

const MATCH_COPY = "MATCH · Previous commitment confirmed";
const MISMATCH_COPY = "MISMATCH · Commitment differs from revealed seed";
const PENDING_COPY = "Computing in your browser…";

describe("VerdictChip", () => {
  it("renders a Skeleton when PENDING", () => {
    render(
      <VerdictChip
        verdict="PENDING"
        matchText={MATCH_COPY}
        mismatchText={MISMATCH_COPY}
        pendingText={PENDING_COPY}
      />,
    );
    const skeleton = document.querySelector('[data-slot="verdict-chip-pending"]');
    expect(skeleton).not.toBeNull();
    expect(screen.queryByText(MATCH_COPY)).toBeNull();
  });

  it("MATCH renders the matchText and a CheckCircle2 SVG", () => {
    const { container } = render(
      <VerdictChip
        verdict="MATCH"
        matchText={MATCH_COPY}
        mismatchText={MISMATCH_COPY}
        pendingText={PENDING_COPY}
      />,
    );
    expect(screen.getByText(MATCH_COPY)).toBeInTheDocument();
    const svg = container.querySelector("svg[aria-hidden='true']");
    expect(svg).not.toBeNull();
  });

  it("MISMATCH renders the mismatchText with aria-live='assertive'", () => {
    render(
      <VerdictChip
        verdict="MISMATCH"
        matchText={MATCH_COPY}
        mismatchText={MISMATCH_COPY}
        pendingText={PENDING_COPY}
      />,
    );
    const chip = screen.getByText(MISMATCH_COPY).closest("[role='status']");
    expect(chip).not.toBeNull();
    expect(chip).toHaveAttribute("aria-live", "assertive");
  });

  it("MATCH has role='status' and aria-live='polite'", () => {
    render(
      <VerdictChip
        verdict="MATCH"
        matchText={MATCH_COPY}
        mismatchText={MISMATCH_COPY}
        pendingText={PENDING_COPY}
      />,
    );
    const chip = screen.getByText(MATCH_COPY).closest("[role='status']");
    expect(chip).not.toBeNull();
    expect(chip).toHaveAttribute("aria-live", "polite");
  });

  it("renders without color-only signaling (icon + text both present in MATCH and MISMATCH)", () => {
    const { container, rerender } = render(
      <VerdictChip
        verdict="MATCH"
        matchText={MATCH_COPY}
        mismatchText={MISMATCH_COPY}
        pendingText={PENDING_COPY}
      />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.getByText(MATCH_COPY)).toBeInTheDocument();
    rerender(
      <VerdictChip
        verdict="MISMATCH"
        matchText={MATCH_COPY}
        mismatchText={MISMATCH_COPY}
        pendingText={PENDING_COPY}
      />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.getByText(MISMATCH_COPY)).toBeInTheDocument();
  });
});
