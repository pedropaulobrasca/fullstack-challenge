CREATE TABLE IF NOT EXISTS inbox (
    consumer_name   TEXT         NOT NULL,
    message_id      UUID         NOT NULL,
    message_type    TEXT         NOT NULL,
    received_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    processed_at    TIMESTAMPTZ,
    payload_hash    TEXT,
    PRIMARY KEY (consumer_name, message_id)
);

CREATE INDEX IF NOT EXISTS inbox_received_at_idx
    ON inbox (received_at)
