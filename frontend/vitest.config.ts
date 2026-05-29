import { resolve } from "node:path";
import { defineConfig, type ViteUserConfig } from "vitest/config";
import viteReact from "@vitejs/plugin-react";

const plugins = [viteReact()] as ViteUserConfig["plugins"];

export default defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
  },
});
