import Link from "next/link";

// Shown at once when an article is tapped, while the server renders it.
// On PCs it fills only the article pane; the list beside it stays.
export default function Loading() {
  return (
    <div className="min-h-dvh lg:min-h-0 lg:min-w-0 lg:flex-1 lg:overflow-y-auto">
      <header className="sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 max-w-2xl items-center px-4 lg:max-w-3xl lg:px-8">
          <Link href="/" className="py-1 pr-2 text-muted" aria-label="戻る">
            ←
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-2xl animate-pulse px-4 pt-4 lg:max-w-3xl lg:px-8" aria-busy="true">
        <div className="h-3 w-1/3 rounded bg-line" />
        <div className="mt-3 h-6 w-11/12 rounded bg-line" />
        <div className="mt-2 h-6 w-3/4 rounded bg-line" />
        <div className="mt-8 flex flex-col gap-3 lg:max-w-[42em]">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className={`h-3.5 rounded bg-line/70 ${i % 3 === 2 ? "w-4/5" : "w-full"}`} />
          ))}
        </div>
      </main>
    </div>
  );
}
