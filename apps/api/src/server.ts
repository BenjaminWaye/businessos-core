import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { createPool } from "@businessos/kernel";
import { createApp } from "./app.js";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(resolve(here, "../../.."), ".env") });

const port = Number(process.env["PORT"] ?? 3001);
const pool = createPool();
const app = createApp(pool);

app.listen(port, () => {
  console.log(`BusinessOS API listening on http://localhost:${port}`);
});
