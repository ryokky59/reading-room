#!/usr/bin/env node
// Runs one SQL statement from stdin against the production database (Neon) inside a READ ONLY
// transaction and prints the rows as JSON. Postgres itself rejects any write.
//
//   echo "select count(*) from articles" | node .claude/scripts/reading-data.mjs
//
// Timestamps are stored in UTC and a `date` prints as a UTC instant, so for a day or week in the
// owner's time write `to_char(fetched_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD')`.
//
// The connection string is fetched here and never printed, so it stays out of an agent's
// transcript. It needs the owner's Neon CLI login (`npx neonctl auth`).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const PROJECT_ID = "round-feather-65545481"; // reading-room-db
const MAX_CHARS = 60_000; // a guard against dumping article bodies into the transcript

const text = readFileSync(0, "utf8").trim();
if (!text) {
  console.error("Give one SQL statement on stdin.");
  process.exit(2);
}

let url;
try {
  url = execFileSync("npx", ["-y", "neonctl", "connection-string", "main", "--project-id", PROJECT_ID], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  }).trim();
} catch (err) {
  console.error("Could not get the connection string. The owner may need to run `npx neonctl auth`.");
  console.error(String(err.stderr ?? err.message).slice(0, 500));
  process.exit(1);
}

try {
  const sql = neon(url);
  const [rows] = await sql.transaction([sql.query(text)], { readOnly: true });
  // One row per line: readable, and far shorter than indented JSON.
  const out = rows.map((r) => JSON.stringify(r)).join("\n");
  if (out.length > MAX_CHARS) {
    console.error(`${rows.length} rows, ${out.length} characters: too much. Aggregate, or select fewer columns or rows.`);
    process.exit(1);
  }
  console.error(`production (reading-room-db), read-only: ${rows.length} rows`);
  if (out) console.log(out);
} catch (err) {
  // The driver's error can carry the connection string's host; the message alone is enough.
  console.error(`Query failed: ${err.message}`);
  process.exit(1);
}
