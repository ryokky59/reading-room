import { EmptyPane } from "@/components/EmptyPane";
import { inboxQuery, parseInboxFilter } from "@/lib/inbox";

// "今すぐ取得" in the list runs as a server action of this page and can take a while.
export const maxDuration = 300;

// Phones show only the list here. On PCs this is the space beside it before an article is chosen.
export default async function InboxPage({ searchParams }: PageProps<"/">) {
  return <EmptyPane query={inboxQuery(parseInboxFilter(await searchParams))} />;
}
