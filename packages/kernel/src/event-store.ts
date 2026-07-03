/**
 * Event store: the persistence side of the kernel.
 *
 * Responsibilities (Milestone 1):
 *   - append events (assigning the global sequence number)
 *   - fetch events for a company in canonical order
 *
 * Immutability is enforced by the database (a trigger rejects UPDATE/DELETE),
 * so there is intentionally no update or delete method here.
 */

import type { Pool } from "pg";
import type { EventDraft, StoredEvent } from "./types.js";

interface EventRow {
  global_seq: string; // bigint comes back as a string from node-postgres
  id: string;
  company_id: string;
  type: string;
  payload: unknown;
  occurred_at: Date;
}

function rowToEvent(row: EventRow): StoredEvent {
  return {
    seq: Number(row.global_seq),
    id: row.id,
    companyId: row.company_id,
    type: row.type,
    payload: row.payload,
    occurredAt: row.occurred_at.toISOString(),
  };
}

export class EventStore {
  constructor(private readonly pool: Pool) {}

  /**
   * Append one or more event drafts. Within a single call the events are
   * inserted in array order inside one transaction, so their sequence numbers
   * are contiguous and ordered. Returns the stored events (with `seq`) in the
   * same order they were given.
   */
  async append(drafts: readonly EventDraft[]): Promise<StoredEvent[]> {
    if (drafts.length === 0) return [];

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const stored: StoredEvent[] = [];
      for (const draft of drafts) {
        const result = await client.query<EventRow>(
          `INSERT INTO events (id, company_id, type, payload, occurred_at)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING global_seq, id, company_id, type, payload, occurred_at`,
          [
            draft.id,
            draft.companyId,
            draft.type,
            JSON.stringify(draft.payload),
            draft.occurredAt,
          ],
        );
        stored.push(rowToEvent(result.rows[0]!));
      }
      await client.query("COMMIT");
      return stored;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /** Fetch all events for a company, in canonical (global sequence) order. */
  async byCompany(companyId: string): Promise<StoredEvent[]> {
    const result = await this.pool.query<EventRow>(
      `SELECT global_seq, id, company_id, type, payload, occurred_at
         FROM events
        WHERE company_id = $1
        ORDER BY global_seq ASC`,
      [companyId],
    );
    return result.rows.map(rowToEvent);
  }
}
