-- Milestone 1 — Event store.
-- An append-only, immutable log. This table is the single source of truth;
-- all business state is derived from it by replaying events through projections.

CREATE TABLE IF NOT EXISTS events (
    -- Global, monotonically increasing sequence number. This is the canonical
    -- total order used by the projection engine. It is assigned by the database
    -- at insert time, so it is stable forever once written.
    global_seq  BIGSERIAL    PRIMARY KEY,

    -- Application-generated unique id for the event (uuid). Lets callers refer
    -- to a specific event independently of its sequence number.
    id          UUID         NOT NULL UNIQUE,

    -- The company (tenant) this event belongs to. Events are always replayed
    -- per company.
    company_id  UUID         NOT NULL,

    -- Event type discriminator, e.g. 'CustomerCreated'.
    type        TEXT         NOT NULL,

    -- Event body. Deterministic: whatever is written here is what is read back.
    payload     JSONB        NOT NULL,

    -- Domain time: when the event is considered to have happened. Supplied by
    -- the caller (and therefore part of the deterministic event data), NOT a
    -- wall-clock default. Projections may use this freely.
    occurred_at TIMESTAMPTZ  NOT NULL,

    -- Bookkeeping only: wall-clock time the row was persisted. Projections must
    -- NEVER read this, or replay would be non-deterministic.
    recorded_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Fast per-company replay in canonical order.
CREATE INDEX IF NOT EXISTS idx_events_company_seq
    ON events (company_id, global_seq);

-- Immutability guarantee: the log is append-only. Any attempt to UPDATE or
-- DELETE an event is rejected at the database level.
CREATE OR REPLACE FUNCTION reject_event_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'events is an append-only log: % is not permitted', TG_OP
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_events_immutable ON events;
CREATE TRIGGER trg_events_immutable
    BEFORE UPDATE OR DELETE ON events
    FOR EACH ROW EXECUTE FUNCTION reject_event_mutation();
