import { Header } from "@/components/Header";
import { PendingWhileMounted } from "@/components/NavPending";

// Shown at once on navigation while the server renders the page.
export default function Loading() {
  return (
    <>
      <PendingWhileMounted />
      <Header />
      <main className="mx-auto max-w-5xl px-4 pt-6" aria-busy="true">
        <ul className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="animate-pulse rounded-xl border border-line bg-surface p-4">
              <div className="h-3 w-1/3 rounded bg-line" />
              <div className="mt-3 h-4 w-11/12 rounded bg-line" />
              <div className="mt-2 h-4 w-2/3 rounded bg-line" />
              <div className="mt-4 h-3 w-full rounded bg-line/70" />
              <div className="mt-2 h-3 w-5/6 rounded bg-line/70" />
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
