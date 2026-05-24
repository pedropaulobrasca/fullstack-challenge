declare const __brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type PlayerId = Brand<string, "PlayerId">;
export type RoundId = Brand<string, "RoundId">;
export type BetId = Brand<string, "BetId">;
export type WalletId = Brand<string, "WalletId">;
export type TransactionId = Brand<string, "TransactionId">;
export type CorrelationId = Brand<string, "CorrelationId">;

export const PlayerId = (raw: string): PlayerId => raw as PlayerId;
export const RoundId = (raw: string): RoundId => raw as RoundId;
export const BetId = (raw: string): BetId => raw as BetId;
export const WalletId = (raw: string): WalletId => raw as WalletId;
export const TransactionId = (raw: string): TransactionId => raw as TransactionId;
export const CorrelationId = (raw: string): CorrelationId => raw as CorrelationId;
