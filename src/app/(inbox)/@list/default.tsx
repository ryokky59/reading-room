import { ListAfterFullLoad } from "@/components/InboxShell";

// The list pane at an article URL, which has no list page of its own. On a click in the list
// Next.js keeps what the pane showed and drops this, so the server builds no list here: that
// would be thrown away on every article switch. Only when the article is loaded directly (or
// reloaded) does this show, and on PCs it then loads the list beside the article.
export default function InboxListDefault() {
  return <ListAfterFullLoad />;
}
