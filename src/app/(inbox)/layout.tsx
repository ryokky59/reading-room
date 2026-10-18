import { InboxShell } from "@/components/InboxShell";

// The inbox and the article pages share this layout. On PCs the `list` slot is the pane on the
// left; it is a parallel route, so moving between articles re-renders only `children`.
export default function InboxLayout({ list, children }: LayoutProps<"/">) {
  return <InboxShell list={list}>{children}</InboxShell>;
}
