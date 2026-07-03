/**
 * Replay: rebuild business state from the event log.
 *
 * This is the foundation proof of the kernel. State is never stored directly;
 * it is always derived by reading every event for a company out of the store
 * and folding them through the (pure, deterministic) projection.
 *
 *   DB events -> rebuild state -> identical output, every time.
 *
 * The wall clock is read exactly once, here at the edge, and passed into
 * `project` as an explicit `asOf` value — `project` itself never touches
 * `Date.now()`. Pass a fixed `asOf` to get fully reproducible output (used by
 * the replay determinism tests); omit it in production to get "state right
 * now".
 */

import type { EventStore } from "./event-store.js";
import { project } from "./projection.js";
import type { State } from "./state.js";

/** Rebuild a company's current state from scratch out of the event store. */
export async function replayCompany(
  store: EventStore,
  companyId: string,
  asOf: string = new Date().toISOString(),
): Promise<State> {
  const events = await store.byCompany(companyId);
  return project(events, asOf);
}
