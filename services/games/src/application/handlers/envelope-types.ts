import type {
  WalletDebitedPayload,
  WalletDebitRejectedPayload,
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

export type WalletDebitedEnvelope = AmqpEnvelope<"wallet.debited", WalletDebitedPayload>;
export type WalletDebitRejectedEnvelope = AmqpEnvelope<
  "wallet.debit.rejected",
  WalletDebitRejectedPayload
>;
