import { noteNavStart } from "@/lib/last-nav";

// Called synchronously as each App Router navigation starts. See useArticleUrlAfterListChange.
export function onRouterTransitionStart(url: string) {
  noteNavStart(url);
}
