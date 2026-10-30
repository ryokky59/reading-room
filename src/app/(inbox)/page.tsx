import { EmptyPane } from "@/components/EmptyPane";
import { inboxQuery, parseInboxFilter, showsBoard } from "@/lib/inbox";

// "今すぐ取得" in the header runs as a server action of this page and can take a while.
export const maxDuration = 300;

// Phones show only the list here. On PCs this is the space beside a feed list before an article
// is chosen; the Board takes the whole width.
export default async function InboxPage({ searchParams }: PageProps<"/">) {
  const filter = parseInboxFilter(await searchParams);
  return showsBoard(filter) ? null : <EmptyPane query={inboxQuery(filter)} />;
}
