CREATE TABLE IF NOT EXISTS outbox (
    id                  BIGSERIAL    PRIMARY KEY,
    message_id          UUID         NOT NULL UNIQUE,
    aggregate_type      TEXT         NOT NULL,
    aggregate_id        TEXT         NOT NULL,
    event_type          TEXT         NOT NULL,
    event_version       INT          NOT NULL DEFAULT 1,
    exchange            TEXT         NOT NULL,
    routing_key         TEXT         NOT NULL,
    payload             JSONB        NOT NULL,
    headers             JSONB        NOT NULL,
    status              TEXT         NOT NULL DEFAULT 'PENDING'
                                     CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),
    attempts            INT          NOT NULL DEFAULT 0,
    last_error          TEXT,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    published_at        TIMESTAMPTZ,
    last_attempt_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS outbox_pending_idx
    ON outbox (created_at)
    WHERE status = 'PENDING';

CREATE OR REPLACE FUNCTION outbox_notify_fn() RETURNS trigger AS $$
BEGIN
    PERFORM pg_notify('outbox_new_message', NEW.id::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS outbox_notify_trigger ON outbox;

CREATE TRIGGER outbox_notify_trigger
    AFTER INSERT ON outbox
    FOR EACH ROW
    EXECUTE FUNCTION outbox_notify_fn()
