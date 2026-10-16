import { fetchAllFeeds } from "@/lib/feeds";

export const maxDuration = 300;

// Called daily by Vercel Cron (see vercel.json), which sends CRON_SECRET as a bearer token.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return Response.json(await fetchAllFeeds());
}
