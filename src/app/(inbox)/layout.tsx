import { InboxShell } from "@/components/InboxShell";
import { lastFetchedLabel } from "@/lib/board";

// The inbox and the article pages share this layout. On PCs the `list` slot is the pane on the
// left; it is a parallel route, so moving between articles re-renders only `children`.
export default async function InboxLayout({ list, children }: LayoutProps<"/">) {
  return (
    <InboxShell list={list} lastFetched={await lastFetchedLabel()}>
      {children}
    </InboxShell>
  );
}
