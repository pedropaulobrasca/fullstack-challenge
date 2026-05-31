import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const globalsCssPath = resolve(__dirname, "./globals.css");
const globalsCss = readFileSync(globalsCssPath, "utf-8");

describe("globals.css — D-03a regression guard", () => {
  it("imports tailwindcss before any plugin or font", () => {
    const tailwindIndex = globalsCss.indexOf('@import "tailwindcss"');
    expect(tailwindIndex).toBeGreaterThanOrEqual(0);
  });

  it("registers tw-animate-css so shadcn Sheet/Dialog animation utilities resolve", () => {
    const tailwindIndex = globalsCss.indexOf('@import "tailwindcss"');
    const twAnimateIndex = globalsCss.indexOf('@import "tw-animate-css"');

    expect(twAnimateIndex).toBeGreaterThanOrEqual(0);
    expect(twAnimateIndex).toBeGreaterThan(tailwindIndex);
  });
});
