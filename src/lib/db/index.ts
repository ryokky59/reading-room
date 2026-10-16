import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import * as schema from "./schema";

type DB = ReturnType<typeof drizzleNeon<typeof schema>>;

declare global {
  var __readingRoomDb: Promise<DB> | undefined;
}

// Production uses Neon. Without DATABASE_URL (local dev) an embedded PGlite
// database under .data/ is used and migrated automatically.
async function connect(): Promise<DB> {
  if (process.env.DATABASE_URL) {
    return drizzleNeon(neon(process.env.DATABASE_URL), { schema });
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(".data", { recursive: true });
  const db = drizzle(new PGlite(".data/pglite"), { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  return db as unknown as DB;
}

export function getDb(): Promise<DB> {
  globalThis.__readingRoomDb ??= connect();
  return globalThis.__readingRoomDb;
}

export * from "./schema";
