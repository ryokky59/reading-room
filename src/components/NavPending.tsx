"use client";

import { useLinkStatus } from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/**
 * Whether anything is waiting for the next screen, as a count of the sources that are: a pressed
 * Link (LinkPending), a loading skeleton (PendingWhileMounted), or a server action and the
 * navigation after it (useNavPending with a transition's isPending). NavProgress shows the bar.
 */
type NavPending = { count: number; begin: () => () => void };

const NavPendingContext = createContext<NavPending>({ count: 0, begin: () => () => {} });

export function NavPendingProvider({ children }: { children: React.ReactNode }) {
  const [count, setCount] = useState(0);
  const begin = useCallback(() => {
    setCount((n) => n + 1);
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      setCount((n) => n - 1);
    };
  }, []);
  return <NavPendingContext.Provider value={{ count, begin }}>{children}</NavPendingContext.Provider>;
}

/** Counts as waiting while `pending` is true (e.g. a transition's isPending). */
export function useNavPending(pending: boolean) {
  const { begin } = useContext(NavPendingContext);
  useEffect(() => (pending ? begin() : undefined), [pending, begin]);
}

/**
 * Put inside a Link. While the Link is waiting for its page (before the URL changes), marks
 * itself `data-pending="true"`, so the card around it can show which one was pressed with
 * `:has([data-pending="true"])`, and keeps the bar running.
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  useNavPending(pending);
  return <span hidden data-pending={pending ? "true" : undefined} />;
}

/** Put in a loading.tsx: the bar keeps running while the skeleton shows. */
export function PendingWhileMounted() {
  useNavPending(true);
  return null;
}

/**
 * The thin bar at the top of the screen while something is waiting. Shows after 100ms (a fast
 * screen change shows nothing), runs to 80% in 1.2s, then fills and fades once nothing waits.
 * Fixed to the viewport: keep it out of anything that may be transformed (a pressed card).
 */
export function NavProgress() {
  const { count } = useContext(NavPendingContext);
  const [state, setState] = useState<"idle" | "run" | "done">("idle");
  const running = useRef(false);
  useEffect(() => {
    if (count > 0) {
      if (running.current) return;
      const timer = setTimeout(() => {
        running.current = true;
        setState("run");
      }, 100);
      return () => clearTimeout(timer);
    }
    if (!running.current) return;
    running.current = false;
    setState("done");
    const timer = setTimeout(() => setState("idle"), 400);
    return () => clearTimeout(timer);
  }, [count]);
  return (
    <div
      data-nav-progress=""
      data-active={state === "run" ? "true" : undefined}
      data-state={state}
      aria-hidden="true"
      className="nav-progress"
    >
      <i />
    </div>
  );
}
