import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { PGlite } from "@electric-sql/pglite";
import { expect, test } from "./test";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { checkMigrations, missingMigrations, readLocalMigrations, type CheckInput } from "../src/lib/migrations";

// The check `npm run build` runs before `next build` (scripts/check-migrations.mts, #235). No page
// and no production database: the applied hashes come from an in-memory PGlite that Drizzle's own
// migrator filled (so the hashes are the ones Drizzle writes), or from a list written here.

const root = resolve(__dirname, "..");
const folder = join(root, "drizzle");
const local = readLocalMigrations(folder);
const last = local[local.length - 1].file;
const URL_ = "postgres://neondb_owner:s3cret-pw@ep-test-123.example.neon.tech/neondb?sslmode=require";

/** checkMigrations with its output collected; `applied` plays drizzle.__drizzle_migrations. */
async function check(over: Partial<CheckInput> & { applied?: () => Promise<string[]> }) {
  const out: string[] = [];
  const err: string[] = [];
  let reads = 0;
  const code = await checkMigrations({
    vercelEnv: "production",
    databaseUrl: URL_,
    folder,
    readApplied: async () => {
      reads++;
      return over.applied ? over.applied() : local.map((m) => m.hash);
    },
    log: (line) => out.push(line),
    error: (line) => err.push(line),
    ...over,
  });
  return { code, out: out.join("\n"), err: err.join("\n"), reads };
}

/** Every hash in drizzle.__drizzle_migrations of a fresh PGlite that Drizzle migrated, after `change`. */
async function appliedInPglite(change?: string) {
  const pg = new PGlite();
  try {
    await migrate(drizzle(pg), { migrationsFolder: folder });
    if (change) await pg.exec(change);
    const { rows } = await pg.query<{ hash: string }>("select hash from drizzle.__drizzle_migrations");
    return rows.map((r) => r.hash);
  } finally {
    await pg.close();
  }
}

test("本番でもすべて当たっていれば進む(ハッシュは Drizzle が書くものと同じ)", async () => {
  test.setTimeout(60_000);
  const applied = await appliedInPglite();
  expect(applied).toHaveLength(local.length);
  const r = await check({ applied: async () => applied });
  expect(r.code).toBe(0);
  expect(r.reads).toBe(1);
  expect(r.err).toBe("");
  expect(r.out).toContain(`${local.length} 本すべて`);
});

test("末尾の 1 本が当たっていなければ、そのファイル名を出して止める", async () => {
  test.setTimeout(60_000);
  const applied = await appliedInPglite(
    "delete from drizzle.__drizzle_migrations where id = (select max(id) from drizzle.__drizzle_migrations)",
  );
  expect(applied).toHaveLength(local.length - 1);
  const r = await check({ applied: async () => applied });
  expect(r.code).toBe(1);
  expect(r.err).toContain(`drizzle/${last}`);
  expect(r.err).toContain("1 本");
  // Only the missing one is listed.
  for (const m of local.slice(0, -1)) expect(r.err).not.toContain(m.file);
  expect(r.err).not.toContain("s3cret-pw");
  expect(r.err).not.toContain(URL_);
});

test("件数が同じでもハッシュが違えば、足りないとして止める", async () => {
  test.setTimeout(60_000);
  const second = local[1];
  const applied = await appliedInPglite(
    `update drizzle.__drizzle_migrations set hash = 'not-the-file' where hash = '${second.hash}'`,
  );
  expect(applied).toHaveLength(local.length);
  const r = await check({ applied: async () => applied });
  expect(r.code).toBe(1);
  expect(r.err).toContain(`drizzle/${second.file}`);
  expect(r.err).not.toContain(last);

  // The same with a list: as many rows as the journal, one of them a renamed file's.
  expect(missingMigrations(local, [...local.slice(0, -1).map((m) => m.hash), "renamed"])).toEqual([last]);
  expect(missingMigrations(local, local.map((m) => m.hash))).toEqual([]);
});

test("本番 DB を読めなければ止め、接続文字列は出さない", async () => {
  const r = await check({
    applied: async () => {
      throw new Error(`connect failed for ${URL_} (user neondb_owner, password s3cret-pw)`);
    },
  });
  expect(r.code).toBe(1);
  expect(r.err).toContain("読めませんでした");
  for (const secret of [URL_, "s3cret-pw", "neondb_owner", "ep-test-123.example.neon.tech"]) {
    expect(r.err).not.toContain(secret);
    expect(r.out).not.toContain(secret);
  }
});

test("VERCEL_ENV が production でなければ、DB を読まずに進む", async () => {
  for (const vercelEnv of [undefined, "", "preview", "development", "Production"]) {
    const r = await check({
      vercelEnv,
      applied: async () => {
        throw new Error("must not be read");
      },
    });
    expect(r.code, String(vercelEnv)).toBe(0);
    expect(r.reads, String(vercelEnv)).toBe(0);
  }
  // Production without DATABASE_URL has nothing to read either.
  const r = await check({ databaseUrl: undefined });
  expect(r.code).toBe(0);
  expect(r.reads).toBe(0);
});

test("ビルドのスクリプトは preview や VERCEL_ENV なしでは DB を読まずに 0 で終わる", async () => {
  test.setTimeout(60_000);
  for (const vercelEnv of [undefined, "preview"]) {
    // A connection string that would fail at once if it were read: nothing listens on port 1.
    const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: "postgres://u:s3cret-pw@127.0.0.1:1/db" };
    if (vercelEnv) env.VERCEL_ENV = vercelEnv;
    else delete env.VERCEL_ENV;
    const { stdout, stderr } = await promisify(execFile)("npx", ["tsx", join(root, "scripts", "check-migrations.mts")], {
      cwd: root,
      env,
    });
    expect(stdout).toContain("読まずに進みます");
    expect(stderr).not.toContain("照合");
  }
});
