import type { ZodType } from "zod";
import { Money } from "@crash/shared-kernel";
import {
  roundSnapshotPayloadSchema,
  roundStartedPayloadSchema,
  roundRunningPayloadSchema,
  roundCrashedPayloadSchema,
  roundSettledPayloadSchema,
  roundTickPayloadSchema,
  betPlacedPayloadSchema,
  betCashedOutPayloadSchema,
  betMyActivePayloadSchema,
  betMyRefundedPayloadSchema,
  betMyCashedOutPayloadSchema,
} from "@/lib/ws-payloads";
import { useRoundStore, type RoundStatus } from "@/stores/round.store";
import { useMultiplierStore } from "@/stores/multiplier.store";
import { useWalletStore } from "@/stores/wallet.store";
import { useFeedStore } from "@/stores/feed.store";
import { useBetStore } from "@/stores/bet.store";
import { useHistoryStore } from "@/stores/history.store";
import { requestWalletRefetch } from "@/lib/wallet-refetch";

export const WS_EVENTS = [
  "round:snapshot",
  "round:started",
  "round:running",
  "round:crashed",
  "round:settled",
  "round:tick",
  "bet:placed",
  "bet:cashed_out",
  "bet:my_active",
  "bet:my_refunded",
  "bet:my_cashed_out",
] as const;

export type WsEvent = (typeof WS_EVENTS)[number];

const schemaByEvent: Record<WsEvent, ZodType> = {
  "round:snapshot": roundSnapshotPayloadSchema,
  "round:started": roundStartedPayloadSchema,
  "round:running": roundRunningPayloadSchema,
  "round:crashed": roundCrashedPayloadSchema,
  "round:settled": roundSettledPayloadSchema,
  "round:tick": roundTickPayloadSchema,
  "bet:placed": betPlacedPayloadSchema,
  "bet:cashed_out": betCashedOutPayloadSchema,
  "bet:my_active": betMyActivePayloadSchema,
  "bet:my_refunded": betMyRefundedPayloadSchema,
  "bet:my_cashed_out": betMyCashedOutPayloadSchema,
};

function toMs(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function statusToRoundStatus(status: string): RoundStatus {
  switch (status) {
    case "BETTING":
    case "RUNNING":
    case "CRASHED":
    case "SETTLED":
      return status;
    default:
      return "IDLE";
  }
}

const handlers: { [E in WsEvent]: (payload: unknown) => void } = {
  "round:snapshot": (raw) => {
    const payload = roundSnapshotPayloadSchema.parse(raw);
    const { round, myBet, serverTime } = payload;
    const status = statusToRoundStatus(round.status);
    const roundStartedAt =
      status === "RUNNING" && round.startedAt ? toMs(round.startedAt) : null;
    useRoundStore.getState().applySnapshot({
      roundId: round.id,
      status,
      bettingEndsAt: toMs(round.bettingEndsAt),
      roundStartedAt,
      crashValue: round.crashPoint,
    });
    useMultiplierStore.getState().seedOffset(serverTime);
    useBetStore.getState().setMyBet(
      myBet === null
        ? null
        : {
            betId: myBet.betId,
            roundId: round.id,
            amount: {
              amount: myBet.amount.amount,
              currency: myBet.amount.currency,
              scale: myBet.amount.scale,
            },
            status: myBet.status,
            cashoutMultiplier: myBet.cashoutMultiplier,
          },
    );
  },
  "round:started": (raw) => {
    const payload = roundStartedPayloadSchema.parse(raw);
    useRoundStore.getState().setBetting({
      roundId: payload.roundId,
      bettingEndsAt: toMs(payload.bettingEndsAt) ?? Date.now(),
    });
  },
  "round:running": (raw) => {
    const payload = roundRunningPayloadSchema.parse(raw);
    const roundStartedAt = toMs(payload.startedAt) ?? Date.now();
    useRoundStore
      .getState()
      .setRunning({ roundId: payload.roundId, roundStartedAt });
  },
  "round:crashed": (raw) => {
    const payload = roundCrashedPayloadSchema.parse(raw);
    useRoundStore
      .getState()
      .setCrashed({ roundId: payload.roundId, crashValue: payload.crashPoint });
    useHistoryStore.getState().prependCrash({
      roundId: payload.roundId,
      crashPoint: payload.crashPoint,
    });
  },
  "round:settled": (raw) => {
    const payload = roundSettledPayloadSchema.parse(raw);
    useRoundStore.getState().setSettled({ roundId: payload.roundId });
    useBetStore.getState().resolveLostForRound(payload.roundId);
    requestWalletRefetch();
  },
  "round:tick": (raw) => {
    const payload = roundTickPayloadSchema.parse(raw);
    useMultiplierStore.getState().reconcile({
      serverTimestamp: payload.t,
      multiplier: payload.multiplier,
    });
  },
  "bet:placed": (raw) => {
    const payload = betPlacedPayloadSchema.parse(raw);
    useFeedStore.getState().push({
      id: `${payload.betId}:placed`,
      roundId: payload.roundId,
      betId: payload.betId,
      playerIdMasked: payload.playerIdMasked,
      kind: "placed",
      amount: {
        amount: payload.amount.amount,
        currency: payload.amount.currency,
        scale: payload.amount.scale,
      },
      isOwn: useBetStore.getState().myBet?.betId === payload.betId,
    });
  },
  "bet:cashed_out": (raw) => {
    const payload = betCashedOutPayloadSchema.parse(raw);
    useFeedStore.getState().push({
      id: `${payload.betId}:cashed_out`,
      roundId: payload.roundId,
      betId: payload.betId,
      playerIdMasked: payload.playerIdMasked,
      kind: "cashed_out",
      multiplier: payload.multiplier,
      isOwn: useBetStore.getState().myBet?.betId === payload.betId,
    });
  },
  "bet:my_active": (raw) => {
    const payload = betMyActivePayloadSchema.parse(raw);
    useBetStore.getState().setMyBet({
      betId: payload.betId,
      roundId: payload.roundId,
      amount: {
        amount: payload.amount.amount,
        currency: payload.amount.currency,
        scale: payload.amount.scale,
      },
      status: "ACTIVE",
      cashoutMultiplier: null,
    });
  },
  "bet:my_refunded": (raw) => {
    const payload = betMyRefundedPayloadSchema.parse(raw);
    const bet = useBetStore.getState();
    if (bet.myBet?.betId === payload.betId) {
      bet.setStatus("REFUNDED");
    }
    requestWalletRefetch();
  },
  "bet:my_cashed_out": (raw) => {
    const payload = betMyCashedOutPayloadSchema.parse(raw);
    useBetStore.getState().setCashedOut({ multiplier: payload.multiplier });
    const payout = Money.fromSnapshot({
      amount: payload.payout.amount,
      currency: payload.payout.currency,
      scale: payload.payout.scale,
    });
    useWalletStore.getState().credit(payout.toSnapshot());
    requestWalletRefetch();
  },
};

type WsSubscriber = (payload: unknown) => void;

const subscribers: { [E in WsEvent]: Set<WsSubscriber> } = {
  "round:snapshot": new Set(),
  "round:started": new Set(),
  "round:running": new Set(),
  "round:crashed": new Set(),
  "round:settled": new Set(),
  "round:tick": new Set(),
  "bet:placed": new Set(),
  "bet:cashed_out": new Set(),
  "bet:my_active": new Set(),
  "bet:my_refunded": new Set(),
  "bet:my_cashed_out": new Set(),
};

export function subscribeWsEvent(
  event: WsEvent,
  handler: WsSubscriber,
): () => void {
  subscribers[event].add(handler);
  return () => {
    subscribers[event].delete(handler);
  };
}

export function dispatchWsEvent(event: WsEvent, payload: unknown): void {
  const schema = schemaByEvent[event];
  const result = schema.safeParse(payload);
  if (!result.success) {
    console.warn(`Dropping invalid WS payload for "${event}"`, result.error.issues);
    return;
  }
  handlers[event](payload);
  for (const subscriber of subscribers[event]) {
    try {
      subscriber(payload);
    } catch (err) {
      console.warn(`WS subscriber for "${event}" threw`, err);
    }
  }
}
