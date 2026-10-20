// The article pane at `/articles/<id>/list`, which only the list pane has a page for. On the
// client-side navigation there, Next.js keeps the open article instead of rendering this.
// Loaded directly, InboxShell at once replaces the URL with the article's own.
export default function ArticlePaneDefault() {
  return null;
}
