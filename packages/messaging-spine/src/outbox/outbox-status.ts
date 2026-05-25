export const OUTBOX_STATUSES = ['PENDING', 'PUBLISHED', 'FAILED'] as const;

export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];
