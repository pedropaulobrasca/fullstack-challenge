import type { DineroCurrency } from "dinero.js/bigint";

export type Currency = DineroCurrency<bigint>;

export const CRD: Currency = {
  code: "CRD",
  base: 10n,
  exponent: 2n,
};
