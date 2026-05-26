export function multiplierAt(elapsedMs: number, growthRate: number): number {
  if (growthRate <= 0) {
    throw new Error("multiplierAt: growthRate must be greater than zero");
  }
  return Math.exp((growthRate * elapsedMs) / 1000);
}

export function crashTimeMs(growthRate: number, crashPoint: number): number {
  if (growthRate <= 0) {
    throw new Error("crashTimeMs: growthRate must be greater than zero");
  }
  if (crashPoint < 1.0) {
    throw new Error("crashTimeMs: crashPoint must be at least 1.00");
  }
  return Math.round((Math.log(crashPoint) / growthRate) * 1000);
}
