export const EXCHANGES = {
  WALLET_COMMANDS: "wallet.commands",
  WALLET_EVENTS: "wallet.events",
  GAME_EVENTS: "game.events",
  WALLET_DLX: "wallet.dlx",
  GAME_DLX: "game.dlx",
} as const;

export const QUEUES = {
  WALLET_COMMANDS: "wallet.commands.q",
  GAMES_WALLET_EVENTS: "games.wallet-events.q",
  WALLET_DLQ: "wallet.dlq",
  GAMES_DLQ: "games.dlq",
} as const;

export type ExchangeName = (typeof EXCHANGES)[keyof typeof EXCHANGES];
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export function buildQuorumArgs(
  deliveryLimit: number,
  dlxName?: string,
): Record<string, unknown> {
  return {
    "x-queue-type": "quorum",
    "x-delivery-limit": deliveryLimit,
    ...(dlxName ? { "x-dead-letter-exchange": dlxName } : {}),
  };
}

const EXCHANGE_TO_DLX: Record<string, string> = {
  [EXCHANGES.WALLET_COMMANDS]: EXCHANGES.WALLET_DLX,
  [EXCHANGES.WALLET_EVENTS]: EXCHANGES.WALLET_DLX,
  [EXCHANGES.GAME_EVENTS]: EXCHANGES.GAME_DLX,
};

export function deriveDlxFromExchange(exchange: string): string {
  const dlx = EXCHANGE_TO_DLX[exchange];
  if (!dlx) {
    throw new Error(
      `Unknown exchange "${exchange}" — no DLX mapping defined in topology-defaults`,
    );
  }
  return dlx;
}
