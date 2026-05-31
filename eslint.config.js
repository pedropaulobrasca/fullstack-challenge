import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import crashPlugin from "@crash/eslint-plugin";

export default [
  {
    ignores: [
      "node_modules/",
      "dist/",
      "build/",
      "coverage/",
      "playwright-report/",
      "test-results/",
      "**/migrations/",
      ".bun-cache/",
      "**/*.gen.ts",
      "**/*.gen.tsx",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "@crash": crashPlugin,
    },
    rules: {
      "@crash/no-number-for-money": "error",
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "Access process.env only via the typed config layer (src/config/defaults.ts).",
        },
      ],
    },
  },
  {
    files: [
      "**/src/config/**/*.ts",
      "**/mikro-orm.config.ts",
      "services/*/src/main.ts",
      "services/*/src/tracing.ts",
      "services/*/src/observability/pino-config.ts",
      "services/*/src/domain/value-objects/bet-amount.ts",
      "e2e/**/*.config.ts",
      "*.config.ts",
    ],
    rules: {
      "no-restricted-properties": "off",
    },
  },
  {
    files: [
      "**/tests/**/*.ts",
      "**/tests/**/*.tsx",
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
    ],
    rules: {
      "@crash/no-number-for-money": "off",
      "no-restricted-properties": "off",
    },
  },
];
