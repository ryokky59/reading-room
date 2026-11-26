// Which of the repository's Drizzle migrations a database has not applied, for
// scripts/check-migrations.mts (run by `npm run build`). No "server-only" and no app imports: the
// build script and the E2E tests load this file directly.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type LocalMigration = { file: string; hash: string };

/**
 * The migrations listed in `<folder>/meta/_journal.json`, in order, each with the hash Drizzle
 * stores in drizzle.__drizzle_migrations when it applies the file: the SHA-256 of the SQL file's
 * text (`shasum -a 256`), as drizzle-orm's readMigrationFiles computes it.
 */
export function readLocalMigrations(folder: string): LocalMigration[] {
  const journal = JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")) as {
    entries: { tag: string }[];
  };
  return journal.entries.map(({ tag }) => {
    const sql = readFileSync(join(folder, `${tag}.sql`)).toString();
    return { file: `${tag}.sql`, hash: createHash("sha256").update(sql).digest("hex") };
  });
}

/**
 * The files of `local` whose hash is not among `applied`. Matching is by hash, not by count: a
 * file whose text changed after it was applied (or a renamed one, which Drizzle skips by its old
 * `when`) is missing even when the database has as many rows as the journal has entries.
 */
export function missingMigrations(local: LocalMigration[], applied: string[]): string[] {
  const have = new Set(applied);
  return local.filter((m) => !have.has(m.hash)).map((m) => m.file);
}

/**
 * `message` with every secret taken out: each value in `secrets` (the connection string, and the
 * password and user inside it) and any URL with credentials (`scheme://user:pass@host`). A
 * driver's error can quote the URL it was given.
 */
export function redact(message: string, secrets: string[]): string {
  let out = message;
  for (const s of secrets) if (s) out = out.split(s).join("[redacted]");
  return out.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s/@]*@[^\s]*/gi, "[redacted]");
}

/** The parts of a connection string that must not be printed. */
export function secretsOf(url: string): string[] {
  const secrets = [url];
  try {
    const u = new URL(url);
    if (u.password) secrets.push(u.password, decodeURIComponent(u.password));
    if (u.username) secrets.push(u.username, decodeURIComponent(u.username));
    if (u.host) secrets.push(u.host);
  } catch {
    // Not a URL: the whole string is already in the list.
  }
  // Longest first, so a part inside a longer secret does not leave the rest of it behind.
  return [...new Set(secrets)].filter(Boolean).sort((a, b) => b.length - a.length);
}

export type CheckInput = {
  /** VERCEL_ENV. Only "production" reads the database. */
  vercelEnv: string | undefined;
  databaseUrl: string | undefined;
  folder: string;
  /** Every hash in drizzle.__drizzle_migrations of the database at `url`. */
  readApplied: (url: string) => Promise<string[]>;
  log: (line: string) => void;
  error: (line: string) => void;
};

/**
 * What `npm run build` does before `next build`: 0 to go on, 1 to stop the build. Only a Vercel
 * production build reads the database (preview builds share its DATABASE_URL, and a PR's preview
 * comes before its migration is applied; CI and local builds have no production credentials).
 */
export async function checkMigrations(input: CheckInput): Promise<0 | 1> {
  if (input.vercelEnv !== "production") {
    input.log(`マイグレーションの照合: VERCEL_ENV=${input.vercelEnv || "(なし)"} なので本番 DB は読まずに進みます`);
    return 0;
  }
  if (!input.databaseUrl) {
    input.log("マイグレーションの照合: DATABASE_URL がないので読まずに進みます");
    return 0;
  }
  const local = readLocalMigrations(input.folder);
  let applied: string[];
  try {
    applied = await input.readApplied(input.databaseUrl);
  } catch (e) {
    const text = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    input.error(`マイグレーションの照合: 本番 DB の drizzle.__drizzle_migrations を読めませんでした。`);
    input.error(redact(text, secretsOf(input.databaseUrl)));
    return 1;
  }
  const missing = missingMigrations(local, applied);
  if (missing.length === 0) {
    input.log(`マイグレーションの照合: ${local.length} 本すべて本番 DB に当たっています`);
    return 0;
  }
  input.error(`マイグレーションの照合: 本番 DB に当たっていないマイグレーションが ${missing.length} 本あります。`);
  for (const file of missing) input.error(`  drizzle/${file}`);
  input.error(
    "本番 Neon に当ててから、同じコミットをデプロイし直してください(.claude/automation/pick-issue.md 手順 5)。このデプロイは止め、前の本番が動き続けます。",
  );
  return 1;
}
