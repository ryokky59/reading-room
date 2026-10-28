/**
 * A button that sinks when pressed and, while `busy`, cannot be pressed again and shows a
 * spinner before its label. Other buttons held back by the same action pass `disabled` and fade.
 */
export function BusyButton({
  busy = false,
  disabled,
  className,
  children,
  ...props
}: React.ComponentProps<"button"> & { busy?: boolean }) {
  return (
    <button
      {...props}
      disabled={busy || disabled}
      aria-busy={busy || undefined}
      className={`pressable ${busy ? "" : "disabled:opacity-50"} ${className ?? ""}`}
    >
      {busy && <span className="spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
