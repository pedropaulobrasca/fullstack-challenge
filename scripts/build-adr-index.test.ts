import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseAdrFile, readAdrs, renderTable, replaceBetweenMarkers, START_MARKER, END_MARKER } from "./build-adr-index";

describe("build-adr-index", () => {
  let fixtureDir: string;

  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), "adr-index-"));
  });

  afterEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  test("parseAdrFile extracts number, title, status, date, phase from a well-formed ADR", () => {
    const filePath = join(fixtureDir, "ADR-007-test-decision.md");
    writeFileSync(
      filePath,
      [
        "# ADR-007: Test Decision",
        "",
        "**Status**: Accepted",
        "**Date**: 2026-05-30",
        "**Phase**: 3",
        "",
        "## Context",
        "Some context.",
      ].join("\n"),
    );

    const parsed = parseAdrFile(filePath);

    expect(parsed).not.toBeNull();
    expect(parsed!.number).toBe(7);
    expect(parsed!.title).toBe("Test Decision");
    expect(parsed!.status).toBe("Accepted");
    expect(parsed!.date).toBe("2026-05-30");
    expect(parsed!.phase).toBe("3");
    expect(parsed!.slug).toBe("ADR-007-test-decision");
  });

  test("readAdrs returns 3 rows sorted by number ascending from a fixture dir", () => {
    writeFileSync(
      join(fixtureDir, "ADR-010-zeta-decision.md"),
      "# ADR-010: Zeta\n\n**Status**: Accepted\n**Date**: 2026-05-30\n**Phase**: 5\n",
    );
    writeFileSync(
      join(fixtureDir, "ADR-001-alpha.md"),
      "# ADR-001: Alpha\n\n**Status**: Accepted\n**Date**: 2026-05-20\n**Phase**: 1\n",
    );
    writeFileSync(
      join(fixtureDir, "ADR-002-beta.md"),
      "# ADR-002: Beta\n\n**Status**: Accepted\n**Date**: 2026-05-22\n**Phase**: 1\n",
    );

    const adrs = readAdrs(fixtureDir);

    expect(adrs.length).toBe(3);
    expect(adrs[0].number).toBe(1);
    expect(adrs[1].number).toBe(2);
    expect(adrs[2].number).toBe(10);
  });

  test("renderTable produces a markdown table with header + 3 sorted rows + relative ADR links", () => {
    writeFileSync(
      join(fixtureDir, "ADR-001-alpha.md"),
      "# ADR-001: Alpha\n\n**Status**: Accepted\n**Date**: 2026-05-20\n**Phase**: 1\n",
    );
    writeFileSync(
      join(fixtureDir, "ADR-002-beta-thing.md"),
      "# ADR-002: Beta Thing\n\n**Status**: Accepted\n**Date**: 2026-05-22\n**Phase**: 2\n",
    );
    writeFileSync(
      join(fixtureDir, "ADR-010-zeta.md"),
      "# ADR-010: Zeta\n\n**Status**: Superseded\n**Date**: 2026-05-30\n**Phase**: 5\n",
    );

    const adrs = readAdrs(fixtureDir);
    const table = renderTable(adrs);

    expect(table).toContain("| # | Title | Phase | Date | Status |");
    expect(table).toContain("| ADR-001 | [Alpha](.planning/adrs/ADR-001-alpha.md) | 1 | 2026-05-20 | Accepted |");
    expect(table).toContain("| ADR-002 | [Beta Thing](.planning/adrs/ADR-002-beta-thing.md) | 2 | 2026-05-22 | Accepted |");
    expect(table).toContain("| ADR-010 | [Zeta](.planning/adrs/ADR-010-zeta.md) | 5 | 2026-05-30 | Superseded |");
  });

  test("replaceBetweenMarkers replaces ONLY content between sentinel markers; outside is byte-stable", () => {
    const before = [
      "# Project README",
      "",
      "Some intro prose.",
      "",
      "## ADR Catalogue",
      "",
      START_MARKER,
      "OLD STALE TABLE GOES HERE",
      "more stale rows",
      END_MARKER,
      "",
      "## Other section",
      "After-marker content stays exact.",
      "",
    ].join("\n");
    const fresh = "FRESH GENERATED TABLE\nrow1\nrow2";

    const after = replaceBetweenMarkers(before, fresh);

    expect(after).toContain("# Project README");
    expect(after).toContain("Some intro prose.");
    expect(after).toContain("## Other section");
    expect(after).toContain("After-marker content stays exact.");
    expect(after).toContain(START_MARKER);
    expect(after).toContain(END_MARKER);
    expect(after).toContain("FRESH GENERATED TABLE");
    expect(after).not.toContain("OLD STALE TABLE GOES HERE");
    expect(after).not.toContain("more stale rows");
  });

  test("replaceBetweenMarkers throws when sentinel markers are absent", () => {
    const noMarkers = "# README without markers\n\nNo ADR section.\n";
    expect(() => replaceBetweenMarkers(noMarkers, "anything")).toThrow();
  });

  test("parseAdrFile returns row with status '(unknown)' for malformed ADR (missing status line)", () => {
    const filePath = join(fixtureDir, "ADR-099-malformed.md");
    writeFileSync(
      filePath,
      ["# ADR-099: Malformed", "", "**Date**: 2026-05-30", "**Phase**: 9", "", "## Context", "no status."].join("\n"),
    );

    const parsed = parseAdrFile(filePath);

    expect(parsed).not.toBeNull();
    expect(parsed!.number).toBe(99);
    expect(parsed!.title).toBe("Malformed");
    expect(parsed!.status).toBe("(unknown)");
  });

  test("readAdrs ignores non-matching files (e.g. README.md, draft notes)", () => {
    writeFileSync(
      join(fixtureDir, "ADR-001-alpha.md"),
      "# ADR-001: Alpha\n\n**Status**: Accepted\n**Date**: 2026-05-20\n**Phase**: 1\n",
    );
    writeFileSync(join(fixtureDir, "README.md"), "Index file");
    writeFileSync(join(fixtureDir, "draft-notes.md"), "Random notes");
    mkdirSync(join(fixtureDir, "subdir"));

    const adrs = readAdrs(fixtureDir);

    expect(adrs.length).toBe(1);
    expect(adrs[0].number).toBe(1);
  });
});
