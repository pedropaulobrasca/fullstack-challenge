export type CashoutResponseDto = {
  multiplier: number;
  payoutCents: {
    amount: string;
    currency: string;
    scale: number;
  };
};
