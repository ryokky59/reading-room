import { Board } from "@/components/Board";
import { InboxList } from "@/components/InboxList";
import { parseInboxFilter, showsBoard } from "@/lib/inbox";

export default async function InboxListPage({ searchParams }: PageProps<"/">) {
  if (showsBoard(parseInboxFilter(await searchParams))) return <Board searchParams={searchParams} />;
  return <InboxList searchParams={searchParams} onEmptySite="redirect" />;
}
