// The server does not know the screen, but a phone sees only the first rows of each Board
// column (Board.tsx), so it need not be sent the rest. BoardPane (InboxShell.tsx) writes how the
// Board lays out to this cookie, and the Board reads it on the next request, as it does `listed`
// (lib/opened.ts):
//
// - `stack`: the sections of a phone (no `board:` variant, globals.css), a few rows each.
// - `cols`: the columns side by side. A missing or malformed cookie counts as this, so a screen
//   the cookie does not know yet gets every row, as before.
//
// It outlives the sitting: a phone keeps being a phone, so only its first visit gets every row.

export const LAYOUT_COOKIE = "layout";

export type BoardLayout = "stack" | "cols";

export function parseLayout(value: string | undefined): BoardLayout {
  return value === "stack" ? "stack" : "cols";
}
