/**
 * Minimal forward-only migration runner.
 *
 * Applies every *.sql file in infrastructure/migrations in filename order,
 * recording applied filenames in a `_migrations` table so reruns are no-ops.
 * Raw SQL, no framework — matches the kernel's "transparent, no magic" stance.
 *
 * Usage:
 *   pnpm --filter @businessos/kernel migrate
 *   DATABASE_URL=... pnpm --filter @businessos/kernel migrate
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { createPool } from "../db.js";

const here = dirname(fileURLToPath(import.meta.url));
// packages/kernel/src/scripts -> repo root
const repoRoot = resolve(here, "../../../..");
const migrationsDir = join(repoRoot, "infrastructure", "migrations");

async function main(): Promise<void> {
  loadEnv({ path: join(repoRoot, ".env") });

  const pool = createPool();
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS _migrations (
         filename   TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );

    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const applied = new Set(
      (await pool.query<{ filename: string }>("SELECT filename FROM _migrations"))
        .rows.map((r) => r.filename),
    );

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(join(migrationsDir, file), "utf8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO _migrations (filename) VALUES ($1)", [
          file,
        ]);
        await client.query("COMMIT");
        console.log(`applied ${file}`);
        count++;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }

    console.log(count === 0 ? "up to date" : `applied ${count} migration(s)`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
