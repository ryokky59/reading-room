import Link from "next/link";

export function Header({ active }: { active?: "inbox" | "read" | "feeds" }) {
  const tab = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 text-sm ${on ? "bg-text text-bg" : "text-muted"}`}
    >
      {label}
    </Link>
  );
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
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
