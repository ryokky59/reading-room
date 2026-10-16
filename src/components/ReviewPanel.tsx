"use client";

import { useState } from "react";
import { Markdown } from "./Markdown";

export function ReviewPanel({ month, initial }: { month: string; initial: string | null }) {
  const [text, setText] = useState(initial ?? "");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    setOpen(true);
    setText("");
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month }),
      });
      if (!res.ok || !res.body) throw new Error();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setText((t) => t + chunk);
      }
    } catch {
      setText((t) => t + "\n\n(振り返りを作れませんでした)");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <div className="flex gap-3 text-sm">
        {text && !busy && (
          <button onClick={() => setOpen((o) => !o)} className="text-accent">
            {open ? "振り返りを閉じる" : "振り返りを見る"}
          </button>
        )}
        <button onClick={generate} disabled={busy} className="text-muted disabled:opacity-60">
          {busy ? "振り返り中…" : text ? "作り直す" : "この月を振り返る"}
        </button>
      </div>
      {open && (
        <div className="mt-2 rounded-xl border border-line bg-surface p-4">
          {text ? (
            <Markdown text={text} className="prose-sm" />
          ) : (
            <p className="animate-pulse text-sm text-muted">考えています…</p>
          )}
        </div>
      )}
    </div>
  );
}
