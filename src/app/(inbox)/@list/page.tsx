import { InboxList } from "@/components/InboxList";

export default function InboxListPage({ searchParams }: PageProps<"/">) {
  return <InboxList searchParams={searchParams} onEmptySite="redirect" />;
}
