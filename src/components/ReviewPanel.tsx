"use client";

import { useState } from "react";
import { Markdown } from "./Markdown";

// The notes streamReview ends a failed look-back with (src/lib/ai.ts): refused or empty, cut
// off by the length limit, and a server error.
const FAILED_ENDINGS = ["作り直してください)", "もう一度試してください)"];
const CUT_OFF_ENDING = "ここまでで切れました。作り直してください)";

export function ReviewPanel({ month, initial }: { month: string; initial: string | null }) {
  const [text, setText] = useState(initial ?? "");
  // The look-back the database keeps for the month: shown again when a redo fails, since the
  // server does not save a failed one.
  const [saved, setSaved] = useState(initial);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    setOpen(true);
    setText("");
    setNotice(null);
    let received = "";
    let threw = false;
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
        received += chunk;
        setText((t) => t + chunk);
      }
    } catch {
      threw = true;
    }
    const failed = threw || FAILED_ENDINGS.some((e) => received.endsWith(e));
    if (!failed) {
      setSaved(received);
    } else if (saved) {
      // Back to what is kept, with a line saying so; what came of the redo is dropped.
      setText(saved);
      setNotice(
        !threw && received.endsWith(CUT_OFF_ENDING)
          ? "作り直しは途中で切れました。前の振り返りを表示しています。"
          : "作り直せませんでした。前の振り返りを表示しています。",
      );
    } else if (threw) {
      setText((t) => t + "\n\n(振り返りを作れませんでした)");
    }
    setBusy(false);
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
          {notice && (
            <p role="status" className="mb-3 text-sm text-muted">
              {notice}
            </p>
          )}
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
