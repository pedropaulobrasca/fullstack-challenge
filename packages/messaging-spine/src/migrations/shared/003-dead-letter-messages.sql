CREATE TABLE IF NOT EXISTS dead_letter_messages (
    id                      BIGSERIAL    PRIMARY KEY,
    original_message_id     UUID         NOT NULL,
    original_exchange       TEXT         NOT NULL,
    original_routing_key    TEXT         NOT NULL,
    original_queue          TEXT         NOT NULL,
    consumer_name           TEXT         NOT NULL,
    headers                 JSONB        NOT NULL,
    payload                 JSONB        NOT NULL,
    error_class             TEXT,
    error_message           TEXT,
    redelivery_count        INT          NOT NULL,
    received_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (consumer_name, original_message_id)
);

CREATE INDEX IF NOT EXISTS dead_letter_received_at_idx
    ON dead_letter_messages (received_at DESC)
