"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useNavPending } from "./NavPending";

// How long a toast stays when nobody presses 「元に戻す」.
const TOAST_MS = 4000;

type ToastOptions = {
  /** What the toast is about (an article id), so a failure elsewhere does not drop its undo. */
  owner?: number;
  /** Runs on 「元に戻す」, outside any transition; the bar runs until it resolves. */
  undo?: () => Promise<void>;
};

type Toast = ToastOptions & { key: number; message?: string; alert?: string };

type ToastApi = {
  /** Shows `message`, with 「元に戻す」 when there is an `undo`, in place of any toast showing. */
  show: (message: string, options?: ToastOptions) => void;
  /**
   * Shows that something could not be saved, as an alert. It replaces the toast showing, unless
   * that one offers to undo something else: it then keeps its undo and gets the alert on top.
   */
  fail: (alert: string, options?: ToastOptions) => void;
  hide: () => void;
};

const ToastContext = createContext<ToastApi>({ show: () => {}, fail: () => {}, hide: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

/**
 * Holds the one toast at the bottom of the screen. `className` places it: ToastHost is
 * `position: fixed`, so keep this out of anything that may be transformed (a pressed card).
 */
export function ToastProvider({ className, children }: { className?: string; children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const [open, setOpen] = useState(false);
  // Read by fail(), which may be called from an older render's closure (an undo).
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });
  const next = useRef(0);
  const show = useCallback((message: string, options: ToastOptions = {}) => {
    setToast({ key: next.current++, message, ...options });
    setOpen(true);
  }, []);
  const fail = useCallback(
    (alert: string, options: ToastOptions = {}) => {
      setToast((t) =>
        openRef.current && t?.undo && t.owner !== options.owner
          ? { ...t, key: next.current++, alert }
          : { key: next.current++, alert, ...options },
      );
      setOpen(true);
    },
    [],
  );
  const hide = useCallback(() => setOpen(false), []);
  const api = useMemo(() => ({ show, fail, hide }), [show, fail, hide]);

  // A new toast starts its own 4 seconds.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setOpen(false), TOAST_MS);
    return () => clearTimeout(timer);
  }, [open, toast?.key]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastHost toast={toast} open={open} onUndo={hide} className={className} />
    </ToastContext.Provider>
  );
}

/**
 * The toast itself. The live region stays in place and only the box inside it slides in and
 * out, so screen readers hear each new message.
 */
function ToastHost({
  toast,
  open,
  onUndo,
  className,
}: {
  toast: Toast | null;
  open: boolean;
  onUndo: () => void;
  className?: string;
}) {
  const [undoing, startUndo] = useTransition();
  useNavPending(undoing);
  return (
    <div role="status" className={className}>
      <div
        data-open={open ? "true" : undefined}
        inert={!open}
        className="toast pointer-events-auto flex items-center justify-between gap-3 rounded-xl bg-text py-2.5 pl-4 pr-2 text-sm text-bg shadow-[0_8px_30px_rgba(0,0,0,0.25)]"
      >
        <span className="flex min-w-0 flex-col">
          {toast?.alert && <span role="alert">{toast.alert}</span>}
          {toast?.message && <span>{toast.message}</span>}
        </span>
        {toast?.undo && (
          <button
            type="button"
            onClick={() => {
              onUndo();
              // Started here rather than in the transition, so what it shows at once (the card
              // back in the list) is not held until the server has answered.
              const undoing = toast.undo!();
              startUndo(() => undoing);
            }}
            className="pressable shrink-0 rounded-lg px-2 py-1 font-bold text-accent"
          >
            元に戻す
          </button>
        )}
      </div>
    </div>
  );
}
