// Run by `npm run build` before `next build`. On a Vercel production build (VERCEL_ENV=production)
// it reads drizzle.__drizzle_migrations of the production database and exits 1, naming the files,
// when a migration in drizzle/ is not applied there: the deploy then fails and the previous
// production keeps running, instead of new code running on the old schema (#235: 0010 was left
// unapplied and no article was saved for 28 hours). Every other build (preview, CI, local) does not
// touch the database. It never applies a migration; whoever merged does that (pick-issue.md step 5).
//
//   npx tsx scripts/check-migrations.mts
import { join } from "node:path";
import { checkMigrations, redact, secretsOf } from "../src/lib/migrations";

const databaseUrl = process.env.DATABASE_URL;

try {
  const code = await checkMigrations({
    vercelEnv: process.env.VERCEL_ENV,
    databaseUrl,
    folder: join(process.cwd(), "drizzle"),
    readApplied: async (url) => {
      const { neon } = await import("@neondatabase/serverless");
      const rows = (await neon(url).query("select hash from drizzle.__drizzle_migrations")) as { hash: string }[];
      return rows.map((r) => r.hash);
    },
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  });
  process.exitCode = code;
} catch (e) {
  const text = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  console.error("マイグレーションの照合に失敗しました。");
  console.error(redact(text, databaseUrl ? secretsOf(databaseUrl) : []));
  process.exitCode = 1;
}
