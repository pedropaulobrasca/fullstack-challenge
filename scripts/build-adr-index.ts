import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ADRS_DIR = join(here, "..", ".planning", "adrs");
const README_PATH = join(here, "..", "README.md");

export const START_MARKER = "<!-- ADR-INDEX:START -->";
export const END_MARKER = "<!-- ADR-INDEX:END -->";

const ADR_FILENAME_PATTERN = /^ADR-(\d{3})-[a-z0-9-]+\.md$/;
const TITLE_LINE_PATTERN = /^#\s+ADR-\d{3}:\s+(.+?)\s*$/m;
const STATUS_LINE_PATTERN = /^\*\*Status\*\*:\s*(.+?)\s*$/m;
const DATE_LINE_PATTERN = /^\*\*Date\*\*:\s*(.+?)\s*$/m;
const PHASE_LINE_PATTERN = /^\*\*Phase\*\*:\s*(.+?)\s*$/m;

const UNKNOWN = "(unknown)";

export interface AdrRow {
  number: number;
  title: string;
  status: string;
  date: string;
  phase: string;
  slug: string;
}

export function parseAdrFile(filePath: string): AdrRow | null {
  const filename = basename(filePath);
  const match = filename.match(ADR_FILENAME_PATTERN);
  if (!match) return null;

  const number = Number.parseInt(match[1], 10);
  const slug = filename.replace(/\.md$/, "");
  const content = readFileSync(filePath, "utf8");

  const titleMatch = content.match(TITLE_LINE_PATTERN);
  const statusMatch = content.match(STATUS_LINE_PATTERN);
  const dateMatch = content.match(DATE_LINE_PATTERN);
  const phaseMatch = content.match(PHASE_LINE_PATTERN);

  return {
    number,
    title: titleMatch ? titleMatch[1] : UNKNOWN,
    status: statusMatch ? statusMatch[1] : UNKNOWN,
    date: dateMatch ? dateMatch[1] : UNKNOWN,
    phase: phaseMatch ? phaseMatch[1] : UNKNOWN,
    slug,
  };
}

export function readAdrs(adrsDir: string): AdrRow[] {
  const rows: AdrRow[] = [];
  for (const entry of readdirSync(adrsDir)) {
    const fullPath = join(adrsDir, entry);
    const stats = statSync(fullPath);
    if (!stats.isFile()) continue;
    const parsed = parseAdrFile(fullPath);
    if (parsed) rows.push(parsed);
  }
  rows.sort((a, b) => a.number - b.number);
  return rows;
}

export function renderTable(adrs: AdrRow[]): string {
  const header = "| # | Title | Phase | Date | Status |";
  const divider = "| --- | --- | --- | --- | --- |";
  const rows = adrs.map((adr) => {
    const id = `ADR-${String(adr.number).padStart(3, "0")}`;
    const link = `[${adr.title}](.planning/adrs/${adr.slug}.md)`;
    return `| ${id} | ${link} | ${adr.phase} | ${adr.date} | ${adr.status} |`;
  });
  return [header, divider, ...rows].join("\n");
}

export function replaceBetweenMarkers(source: string, fresh: string): string {
  const startIndex = source.indexOf(START_MARKER);
  const endIndex = source.indexOf(END_MARKER);
  if (startIndex === -1 || endIndex === -1) {
    throw new Error(`Sentinel markers not found in source (expected ${START_MARKER} and ${END_MARKER})`);
  }
  if (endIndex < startIndex) {
    throw new Error(`Sentinel markers out of order: ${END_MARKER} appears before ${START_MARKER}`);
  }
  const before = source.slice(0, startIndex + START_MARKER.length);
  const after = source.slice(endIndex);
  return `${before}\n${fresh}\n${after}`;
}

function main() {
  const checkMode = process.argv.includes("--check");
  const adrs = readAdrs(ADRS_DIR);
  const table = renderTable(adrs);
  const currentReadme = readFileSync(README_PATH, "utf8");
  const updatedReadme = replaceBetweenMarkers(currentReadme, table);

  if (checkMode) {
    if (currentReadme !== updatedReadme) {
      console.error("README ADR index is out of sync with .planning/adrs/");
      console.error("Run: bun run docs:adr-index");
      process.exit(1);
    }
    console.log(`ADR index in sync: ${adrs.length} entries`);
    return;
  }

  writeFileSync(README_PATH, updatedReadme);
  console.log(`ADR index rendered: ${adrs.length} entries`);
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("build-adr-index.ts");
if (invokedDirectly) {
  main();
}
