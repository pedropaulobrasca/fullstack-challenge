import { MultiplierOutOfBoundsError } from "../errors";

const SCALE = 10_000;
const MIN_TEN_THOUSANDTHS = 10_000n;

export class Multiplier {
  private constructor(private readonly _tenThousandths: bigint) {}

  static of(value: number): Multiplier {
    if (Number.isNaN(value) || !Number.isFinite(value)) {
      throw new MultiplierOutOfBoundsError(value);
    }
    const scaled = BigInt(Math.round(value * SCALE));
    if (scaled < MIN_TEN_THOUSANDTHS) {
      throw new MultiplierOutOfBoundsError(value);
    }
    return new Multiplier(scaled);
  }

  static fromTenThousandths(scaled: bigint): Multiplier {
    if (scaled < MIN_TEN_THOUSANDTHS) {
      throw new MultiplierOutOfBoundsError(Number(scaled) / SCALE);
    }
    return new Multiplier(scaled);
  }

  get tenThousandths(): bigint {
    return this._tenThousandths;
  }

  toNumber(): number {
    return Number(this._tenThousandths) / SCALE;
  }

  toCentiX(): number {
    return Number(this._tenThousandths / 100n);
  }
}
