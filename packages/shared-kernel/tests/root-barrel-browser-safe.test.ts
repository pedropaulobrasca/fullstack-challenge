import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC_ROOT = resolve(import.meta.dir, "../src");
const ROOT_BARREL = join(SRC_ROOT, "index.ts");
const NODE_BUILTIN_PATTERN =
  /\b(node:crypto|node:fs|node:os|node:net|node:tls|node:dns|node:child_process|node:http|node:https|node:stream|createHash|createHmac|randomBytes)\b/;

function resolveLocalImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const baseDir = resolve(fromFile, "..");
  const candidates = [
    resolve(baseDir, `${spec}.ts`),
    resolve(baseDir, `${spec}/index.ts`),
    resolve(baseDir, spec),
  ];
  for (const candidate of candidates) {
    try {
      const stat = statSync(candidate);
      if (stat.isFile()) return candidate;
      if (stat.isDirectory()) {
        const indexFile = join(candidate, "index.ts");
        statSync(indexFile);
        return indexFile;
      }
    } catch {}
  }
  return null;
}

function collectReachableFiles(entry: string): Set<string> {
  const visited = new Set<string>();
  const queue: string[] = [entry];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const source = readFileSync(current, "utf8");
    const importRegex =
      /(?:^|\n)\s*(?:import|export)\s+(?:[^"';]+\s+from\s+)?["']([^"']+)["']/g;
    for (const match of source.matchAll(importRegex)) {
      const spec = match[1]!;
      const resolved = resolveLocalImport(current, spec);
      if (resolved) queue.push(resolved);
    }
  }
  return visited;
}

describe("root barrel @crash/shared-kernel is browser-safe", () => {
  it("does not statically reach any node: builtin or node:crypto symbol", () => {
    const reachable = collectReachableFiles(ROOT_BARREL);
    const offenders: { file: string; line: number; match: string }[] = [];
    for (const file of reachable) {
      const lines = readFileSync(file, "utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i]!.match(NODE_BUILTIN_PATTERN);
        if (m) {
          offenders.push({ file, line: i + 1, match: m[0]! });
        }
      }
    }
    if (offenders.length > 0) {
      const report = offenders
        .map(
          (o) =>
            `  ${o.file.replace(SRC_ROOT, "<src>")}:${o.line} → ${o.match}`,
        )
        .join("\n");
      throw new Error(
        `Root barrel reaches node-only API; FE bundle will break:\n${report}`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it("identity subpath barrel exposes maskPlayerId and PlayerId", async () => {
    const identity = await import("../src/identity");
    expect(typeof identity.maskPlayerId).toBe("function");
    expect(typeof identity.PlayerId).toBe("function");
  });
});
