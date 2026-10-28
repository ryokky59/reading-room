import Link from "next/link";
import { LinkPending } from "./NavPending";

export function Header({
  active,
  className,
  panes,
}: {
  active?: "inbox" | "read" | "feeds";
  className?: string;
  panes?: boolean; // spans the list / article / chat panes from `split` up
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
      className={`sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur pt-[env(safe-area-inset-top)] ${className ?? ""}`}
    >
      <div className={`mx-auto flex max-w-5xl items-center justify-between px-4 py-3 ${panes ? "split:max-w-none" : ""}`}>
        <Link href="/" className="font-bold tracking-tight">
          Reading Room
        </Link>
        <nav className="flex gap-1">
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
