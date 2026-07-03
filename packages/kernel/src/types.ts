/**
 * Core event types for the BusinessOS kernel.
 *
 * The kernel knows nothing about business meaning — it only knows how to store,
 * order, and replay events. Concrete event payloads are defined alongside the
 * domain that produces them (for Milestone 1, the customer domain in `state.ts`).
 */

/**
 * An event as produced by a command, before it has been persisted.
 *
 * It has no sequence number yet: the global order is assigned by the event
 * store at insert time. Everything here is deterministic data — given the same
 * draft, the store always produces the same stored event.
 */
export interface EventDraft<TPayload = unknown> {
  /** Unique id for this event (uuid). */
  id: string;
  /** The company (tenant) the event belongs to. */
  companyId: string;
  /** Discriminator, e.g. "CustomerCreated". */
  type: string;
  /** Event body. */
  payload: TPayload;
  /** Domain time the event is considered to have happened (ISO 8601). */
  occurredAt: string;
}

/**
 * An event after it has been written to the store.
 *
 * `seq` is the global, monotonically increasing sequence number assigned by the
 * database. It defines the canonical total order in which events are folded by
 * the projection engine, and is stable forever once written.
 */
export interface StoredEvent<TPayload = unknown> extends EventDraft<TPayload> {
  seq: number;
}

/** Canonical ordering for stored events: by global sequence, id as tie-break. */
export function compareEvents(a: StoredEvent, b: StoredEvent): number {
  if (a.seq !== b.seq) return a.seq - b.seq;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
