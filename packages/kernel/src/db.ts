/**
 * Postgres connection pool.
 *
 * Thin wrapper around node-postgres. The kernel uses raw SQL — no ORM — to keep
 * the append-only event store transparent and free of hidden behaviour.
 */

import { Pool, type PoolConfig } from "pg";

export type { Pool } from "pg";

/**
 * Create a pool from a connection string. Defaults to DATABASE_URL.
 * Pass a config to point tests at the test database.
 */
export function createPool(connectionString?: string, config?: PoolConfig): Pool {
  const url = connectionString ?? process.env["DATABASE_URL"];
  if (!url) {
    throw new Error(
      "No database connection string: set DATABASE_URL or pass one explicitly.",
    );
  }
  return new Pool({ connectionString: url, ...config });
}
