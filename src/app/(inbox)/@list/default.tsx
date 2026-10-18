import { InboxList } from "@/components/InboxList";

// Rendered for the list pane when an article URL is loaded directly (or reloaded). After a
// click in the list, the pane instead keeps what it showed, so switching articles does not
// re-fetch it. Next.js renders a default like a page, so it gets the URL's search params.
export default function InboxListDefault({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <InboxList searchParams={searchParams} onEmptySite="folder" />;
}
