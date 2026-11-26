import { fetchAllFeeds } from "@/lib/feeds";
import { ensurePicks } from "@/lib/picks";

export const maxDuration = 300;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Called every hour by Vercel Cron (see vercel.json), which sends CRON_SECRET as a bearer token.
 * Each run first makes sure the morning picks of the day are chosen (lib/picks.ts), then fetches
 * the feeds. The picks go first so that a run that fetches until maxDuration still chooses them;
 * a failure there is logged and the fetch goes on.
 *
 * `?only=picks` runs just the picks and answers with them, for tests and for choosing a day again
 * by hand; `day=YYYY-MM-DD` chooses for that day instead of the current one.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const day = params.get("day") ?? undefined;
  if (day !== undefined && !DAY.test(day)) return Response.json({ error: "bad day" }, { status: 400 });
  if (params.get("only") === "picks") {
    try {
      return Response.json({ picks: await ensurePicks(day) });
    } catch (err) {
      console.error("picks failed", err);
      return Response.json({ error: "picks failed" }, { status: 500 });
    }
  }
  try {
    await ensurePicks(day);
  } catch (err) {
    console.error("picks failed", err);
  }
  return Response.json(await fetchAllFeeds());
}
