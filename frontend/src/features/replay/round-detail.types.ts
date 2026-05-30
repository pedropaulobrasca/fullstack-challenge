export type MoneySnapshot = {
  amount: string;
  currency: string;
  scale: number;
};

export type RoundBetView = {
  betId: string;
  playerIdMasked: string;
  amount: MoneySnapshot;
  status: "PENDING" | "ACTIVE" | "CASHED_OUT" | "LOST" | "REFUNDED";
  cashedOutMultiplier: number | null;
  payout: MoneySnapshot | null;
};
