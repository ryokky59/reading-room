import Link from "next/link";
import { LinkPending } from "./NavPending";

export function Header({
  active,
  className,
  panes,
  controls,
  inert,
}: {
  active?: "inbox" | "read" | "feeds";
  className?: string;
  panes?: boolean; // spans the list / article / chat panes from `split` up
  controls?: React.ReactNode; // the inbox's 今すぐ取得 and URL を追加
  inert?: boolean; // behind the article sheet (InboxShell)
}) {
  const tab = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      className={`pressable rounded-full px-3 py-1 text-sm ${on ? "bg-text text-bg" : "text-muted"}`}
    >
      {label}
      <LinkPending />
    </Link>
  );
  return (
    <header
      // SeenOnScroll measures from its bottom edge on phones.
      data-app-header=""
      inert={inert}
      className={`sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur pt-[env(safe-area-inset-top)] ${className ?? ""}`}
    >
      {/* The insets (0 outside a landscape iPhone) keep the title and the tabs clear of its notch. */}
      <div
        className={`mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 py-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] ${panes ? "split:max-w-none" : ""}`}
      >
        <Link href="/" className="font-bold tracking-tight">
          Reading Room
        </Link>
        {controls && <div className="order-last w-full split:order-none split:w-auto split:min-w-0 split:flex-1">{controls}</div>}
        <nav className="ml-auto flex gap-1 split:ml-0">
          {tab("/", "新着", active === "inbox")}
          {tab("/read", "読了", active === "read")}
          {tab("/feeds", "フィード", active === "feeds")}
        </nav>
      </div>
    </header>
  );
}

/** The article's folder; null means unfiled (未分類). */
export function FolderBadge({ name }: { name: string | null }) {
  return (
    <span className={`max-w-[10em] shrink-0 truncate text-xs font-medium ${name ? "text-accent" : "text-muted"}`}>
      {name ?? "未分類"}
    </span>
  );
}
