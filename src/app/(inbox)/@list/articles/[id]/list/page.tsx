import { InboxList } from "@/components/InboxList";

// A URL only the list pane has: a folder / site chip or 「もっと見る」 beside an open article
// goes here. The article pane has no page for it, so on this client-side navigation it keeps
// the open article (and its half-written chat) while this renders the list for the new filter.
// InboxShell then replaces the URL with the article's own, carrying the filter.
export default function ListBesideArticle({ searchParams }: PageProps<"/articles/[id]/list">) {
  return <InboxList searchParams={searchParams} onEmptySite="folder" />;
}
