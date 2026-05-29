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
    ],
    rules: {
      "no-restricted-properties": "off",
    },
  },
  {
    files: ["**/tests/**/*.ts", "**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@crash/no-number-for-money": "off",
    },
  },
];
