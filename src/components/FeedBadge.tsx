"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A feed's favicon over its initial on the feed's color. The initial shows until the image has
 * loaded, and stays if it fails. The name beside it says the same, so this is hidden from
 * screen readers.
 */
export function FeedBadge({ name, color, favicon }: { name: string; color: string; favicon: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const image = useRef<HTMLImageElement>(null);
  // The image may have settled before hydration attached its handlers.
  useEffect(() => {
    const el = image.current;
    if (!el?.complete) return;
    if (el.naturalWidth === 0) setFailed(favicon);
    else setLoaded(favicon);
  }, [favicon]);
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: color }}
      className="relative flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded text-[11px] font-bold leading-none text-white"
    >
      {[...name][0]}
      {favicon && favicon !== failed && (
        // Not next/image: api/favicon is already the one place that fetches and caches these.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={image}
          src={favicon}
          alt=""
          loading="lazy"
          onLoad={() => setLoaded(favicon)}
          onError={() => setFailed(favicon)}
          className={`absolute inset-0 h-full w-full object-contain ${favicon === loaded ? "bg-surface" : ""}`}
        />
      )}
    </span>
  );
}
