import { Money } from "@crash/shared-kernel";
import { multiplierAt } from "@crash/contracts";

const stakeLabel = Money.of(100000n).toString();
const m = multiplierAt(1000, 0.06);

console.log("Money.of(100000n).toString() =>", stakeLabel);
console.log("multiplierAt(1000, 0.06) =>", m);

if (stakeLabel !== "1000.00 CRD") {
  throw new Error(`unexpected Money.toString output: ${stakeLabel}`);
}
if (!Number.isFinite(m) || m <= 1) {
  throw new Error(`unexpected multiplierAt output: ${m}`);
}

console.log("WORKSPACE_TS_IMPORT_OK");
