import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
config({ path: ".env.local" });
config();
if (!process.env.DATABASE_URL) throw new Error("Configura DATABASE_URL antes de migrar.");
const client = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
try {
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  console.log("Migraciones aplicadas.");
} finally {
  await client.end();
}
