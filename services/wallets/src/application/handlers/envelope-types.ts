import type {
  WalletCreditPayload,
  WalletDebitPayload,
} from "@crash/contracts";

export interface AmqpEnvelope<TType extends string, TPayload> {
  messageId: string;
  correlationId: string;
  causationId: string;
  type: TType;
  version: number;
  occurredAt: string;
  payload: TPayload;
}

export type WalletDebitEnvelope = AmqpEnvelope<"wallet.debit", WalletDebitPayload>;
export type WalletCreditEnvelope = AmqpEnvelope<
  "wallet.credit",
  WalletCreditPayload
>;
