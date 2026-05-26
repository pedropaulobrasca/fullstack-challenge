import { CrashPointOutOfBoundsError } from "../errors";

const SCALE = 100;
const MIN_CENTI = 100n;
const MAX_VALUE = 1e9;

export class CrashPoint {
  private constructor(private readonly _centiX: bigint) {}

  static of(value: number): CrashPoint {
    if (Number.isNaN(value) || !Number.isFinite(value)) {
      throw new CrashPointOutOfBoundsError(value);
    }
    if (value > MAX_VALUE) {
      throw new CrashPointOutOfBoundsError(value);
    }
    const scaled = BigInt(Math.round(value * SCALE));
    if (scaled < MIN_CENTI) {
      throw new CrashPointOutOfBoundsError(value);
    }
    return new CrashPoint(scaled);
  }

  static fromCentiX(centi: number): CrashPoint {
    if (!Number.isFinite(centi) || !Number.isInteger(centi)) {
      throw new CrashPointOutOfBoundsError(centi);
    }
    const scaled = BigInt(centi);
    if (scaled < MIN_CENTI) {
      throw new CrashPointOutOfBoundsError(centi / SCALE);
    }
    return new CrashPoint(scaled);
  }

  get centiX(): bigint {
    return this._centiX;
  }

  toNumber(): number {
    return Number(this._centiX) / SCALE;
  }

  toCentiX(): number {
    return Number(this._centiX);
  }
}
