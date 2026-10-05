import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
let database: ReturnType<typeof drizzle<typeof schema>> | undefined;
export function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL no configurada");
  return (database ??= drizzle(
    postgres(process.env.DATABASE_URL, { max: 3, prepare: false, connect_timeout: 10 }),
    { schema },
  ));
}
