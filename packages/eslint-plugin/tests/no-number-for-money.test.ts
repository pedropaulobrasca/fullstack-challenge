import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, test } from "bun:test";
import * as tsParser from "@typescript-eslint/parser";
import { noNumberForMoney } from "../src/rules/no-number-for-money";

RuleTester.afterAll = afterAll;
RuleTester.it = test;
RuleTester.itOnly = test.only;
RuleTester.describe = describe;

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
  },
});

ruleTester.run("no-number-for-money", noNumberForMoney, {
  valid: [
    { code: "const count: number = 0;" },
    { code: "const attemptCount: number = 0;" },
    { code: "function get(index: number) { return index; }" },
    {
      code: "interface Pagination { pageIndex: number; totalCount: number; multiplier: number; }",
    },
  ],
  invalid: [
    {
      code: "const balance: number = 100;",
      errors: [{ messageId: "banned", data: { name: "balance" } }],
    },
    {
      code: "function placeBet(betAmountCents: number) { return betAmountCents; }",
      errors: [{ messageId: "banned", data: { name: "betAmountCents" } }],
    },
    {
      code: "interface CashoutResult { payout: number; }",
      errors: [{ messageId: "banned", data: { name: "payout" } }],
    },
    {
      code: "class Wallet { wagerCents: number = 0; }",
      errors: [{ messageId: "banned", data: { name: "wagerCents" } }],
    },
  ],
});
