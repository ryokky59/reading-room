// The `children` slot's default for URLs that only the list pane has a page for
// (`/articles/<id>/list`). `next dev` checks that every slot can render such a URL and looks for
// the default right here; without this file it answers 404 for `/articles/<id>/list`. What the
// article pane actually shows there is still `articles/[id]/default.tsx`, the nearer default.
export default function InboxChildrenDefault() {
  return null;
}
