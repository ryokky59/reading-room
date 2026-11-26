"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { markOpenSource } from "@/lib/track";

/**
 * The link of a row of 「今朝の N 本」 on the Board: the article opens as from its column, but its
 * `open` says `picks`. Not for a click that opens another tab (a modifier key; the middle button
 * sends no click) or that stays on the open article: the mark waits for the next change of
 * screen, and would go to whatever article opens next.
 */
export function PickLink({ href, ...props }: Omit<React.ComponentProps<typeof Link>, "href" | "onClick"> & { href: string }) {
  const pathname = usePathname();
  return (
    <Link
      href={href}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (pathname === new URL(href, location.href).pathname) return;
        markOpenSource("picks");
      }}
      {...props}
    />
  );
}
