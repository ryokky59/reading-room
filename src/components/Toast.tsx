"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useNavPending } from "./NavPending";

// How long a toast stays when nobody presses 「元に戻す」.
const TOAST_MS = 4000;

type Toast = { key: number; message: string; undo?: () => Promise<void>; failed?: boolean };

type ToastApi = {
  /** Shows `message` with 「元に戻す」 running `undo`, in place of any toast already showing. */
  show: (message: string, undo?: () => Promise<void>) => void;
  /** Shows that something could not be saved, as an alert in place of any toast showing. */
  fail: (message: string) => void;
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
  const next = useRef(0);
  const show = useCallback((message: string, undo?: () => Promise<void>) => {
    setToast({ key: next.current++, message, undo });
    setOpen(true);
  }, []);
  const fail = useCallback((message: string) => {
    setToast({ key: next.current++, message, failed: true });
    setOpen(true);
  }, []);
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
        <span role={toast?.failed ? "alert" : undefined} className="min-w-0">
          {toast?.message}
        </span>
        {toast?.undo && (
          <button
            type="button"
            onClick={() => {
              const undo = toast.undo!;
              onUndo();
              startUndo(async () => {
                try {
                  await undo();
                } catch (e) {
                  console.error(e);
                }
              });
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
