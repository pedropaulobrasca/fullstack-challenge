export type Seed = string;

const SEED_HEX_PATTERN = /^[0-9a-f]+$/;
const SEED_HEX_LENGTH = 64;

export function isValidSeedHex(value: string): boolean {
  return value.length === SEED_HEX_LENGTH && SEED_HEX_PATTERN.test(value);
}
