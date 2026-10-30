"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A feed's favicon, or its initial on the feed's color when there is none. The name beside it
 * says the same, so this is hidden from screen readers.
 */
export function FeedBadge({ name, color, favicon }: { name: string; color: string; favicon: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  const image = useRef<HTMLImageElement>(null);
  // The image may have failed before hydration attached onError.
  useEffect(() => {
    const el = image.current;
    if (el?.complete && el.naturalWidth === 0) setFailed(el.getAttribute("src"));
  }, [favicon]);
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: color }}
      className="relative flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded text-[11px] font-bold leading-none text-white"
    >
      {[...name][0]}
      {favicon && favicon !== failed && (
        // Not next/image: that would fetch every favicon through this app's server.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={image}
          src={favicon}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(favicon)}
          className="absolute inset-0 h-full w-full bg-surface object-contain"
        />
      )}
    </span>
  );
}
