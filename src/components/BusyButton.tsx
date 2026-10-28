/**
 * A button that sinks when pressed and, while `busy`, cannot be pressed again and shows a
 * spinner before its label. The spinner hangs off the label's left side and the label shifts
 * by half its width, so the button keeps its size. How a disabled button looks (e.g. faded)
 * is left to the caller's className.
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
      className={`pressable ${className ?? ""}`}
    >
      <span className={`relative inline-block ${busy ? "translate-x-[calc(0.45em+3px)]" : ""}`}>
        {busy && <span className="spin absolute top-[calc(50%-0.45em)] right-full" aria-hidden="true" />}
        {children}
      </span>
    </button>
  );
}
