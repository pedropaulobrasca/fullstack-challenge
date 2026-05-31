import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { maskPlayerId, PlayerId } from "../../src";

const FIXTURE_UUID = "3f29b1a2-4d5e-6f7a-8b9c-0d1e2f3a4b5c";

function referenceMask(input: string): string {
  return createHash("sha256").update(input).digest("hex").substring(0, 8);
}

describe("maskPlayerId", () => {
  it("returns an 8-char lowercase hex prefix matching /^[0-9a-f]{8}$/", () => {
    const masked = maskPlayerId(PlayerId(FIXTURE_UUID));
    expect(masked).toMatch(/^[0-9a-f]{8}$/);
    expect(masked.length).toBe(8);
  });

  it("is deterministic for the same input", () => {
    const a = maskPlayerId(PlayerId(FIXTURE_UUID));
    const b = maskPlayerId(PlayerId(FIXTURE_UUID));
    expect(a).toBe(b);
  });

  it("produces a different hash for a different input", () => {
    const a = maskPlayerId(PlayerId(FIXTURE_UUID));
    const b = maskPlayerId(PlayerId("00000000-0000-0000-0000-000000000000"));
    expect(a).not.toBe(b);
  });

  it("matches the SHA256-prefix algorithm contract (cross-environment determinism gate)", () => {
    const masked = maskPlayerId(PlayerId(FIXTURE_UUID));
    expect(masked).toBe(referenceMask(FIXTURE_UUID));
  });

  it("accepts an empty string and returns the empty-string SHA256 prefix", () => {
    const masked = maskPlayerId(PlayerId(""));
    expect(masked).toMatch(/^[0-9a-f]{8}$/);
    expect(masked).toBe(referenceMask(""));
  });
});
