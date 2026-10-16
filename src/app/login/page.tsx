"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { login, type ActionState } from "@/lib/actions";

function LoginForm() {
  const next = useSearchParams().get("next") ?? "/";
  const [state, action, pending] = useActionState<ActionState, FormData>(login, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <input
        type="password"
        name="password"
        autoComplete="current-password"
        placeholder="パスワード"
        required
        className="rounded-lg border border-line bg-surface px-4 py-3 text-base"
      />
      <button
        disabled={pending}
        className="rounded-lg bg-accent px-4 py-3 font-medium text-white disabled:opacity-60"
      >
        {pending ? "確認中…" : "ログイン"}
      </button>
      {state.error && <p className="text-sm text-accent">{state.error}</p>}
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <h1 className="mb-6 text-2xl font-bold">Reading Room</h1>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
