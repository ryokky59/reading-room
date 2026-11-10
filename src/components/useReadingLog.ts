"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { currentViewId, track } from "@/lib/track";

/** How often a scroll is measured, at most. */
const SCROLL_EVERY_MS = 250;

/**
 * Sends `leave` for the open article (see 「行動ログ」 in README.md): how long its tab was
 * visible (`dwell_ms`), the `dwell_ms` of the last scroll, key or pointer input (`active_ms`),
 * and how far down `<main>` came into view at most (`scroll_pct`). Sent when the article is
 * left, and also when the tab is hidden or the page goes away, as the totals so far: the last
 * row of a view is the one to use.
 *
 * Both scrolls are watched: the window on phones, the article's own pane beside the list.
 */
export function useReadingLog(
  articleId: number,
  refs: { pane: RefObject<HTMLElement | null>; main: RefObject<HTMLElement | null> },
  bodyLang: "ja" | "original",
) {
  const lang = useRef(bodyLang);
  useEffect(() => {
    lang.current = bodyLang;
  });
  // The last look at the scroll before the article goes: a layout cleanup still has its DOM,
  // which is gone by the time the effect below cleans up and sends.
  const measureNow = useRef(() => {});
  useLayoutEffect(() => () => measureNow.current(), [articleId]);

  useEffect(() => {
    const pane = refs.pane.current;
    const main = refs.main.current;
    let dwell = 0; // visible time before `visibleSince`
    let visibleSince: number | null = document.visibilityState === "visible" ? performance.now() : null;
    let active = 0;
    // The lowest point of `<main>` seen, in px from its top, and its height then. The share is
    // taken against the height when sent: the translation grows the body while it streams in.
    let reached = 0;
    let height = 0;
    let lastSent = "";

    const dwellNow = () => dwell + (visibleSince === null ? 0 : performance.now() - visibleSince);
    function pause() {
      dwell = dwellNow();
      visibleSince = null;
    }
    function measure() {
      if (!main?.isConnected || !pane) return;
      const box = main.getBoundingClientRect();
      // Zero while hidden (display: none): keep what was seen before.
      if (box.height === 0) return;
      // Beside the list the pane scrolls on its own and may end above the window's bottom; on
      // phones it is as tall as the article and the window scrolls.
      const bottom = Math.min(innerHeight, pane.getBoundingClientRect().bottom);
      reached = Math.max(reached, bottom - box.top);
      height = box.height;
    }
    function send() {
      measure();
      // The view is still this article's here, also in the cleanup: cleanups run before
      // ActivityLog notes the next screen (see currentViewId).
      const viewId = currentViewId(articleId);
      if (!viewId || height === 0) return;
      const dwellMs = Math.round(dwellNow());
      const scrollPct = reached >= height - 1 ? 100 : Math.max(0, Math.floor((reached / height) * 100));
      const fields = { dwellMs, activeMs: Math.round(active), scrollPct, props: { body_lang: lang.current } };
      // pagehide right after visibilitychange (or the other way round) would send the same totals.
      const key = JSON.stringify(fields);
      if (key === lastSent) return;
      lastSent = key;
      // The screen is said here: in the cleanup the URL is already the next screen's.
      track("leave", { ...fields, screen: "article", articleId, viewId });
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    function onScroll() {
      onInput();
      timer ??= setTimeout(() => {
        timer = null;
        measure();
      }, SCROLL_EVERY_MS);
    }
    function onInput() {
      active = dwellNow();
    }
    function onVisibility() {
      if (document.visibilityState === "visible") {
        visibleSince ??= performance.now();
      } else {
        pause();
        send();
      }
    }
    function onPageHide() {
      pause();
      send();
    }
    function onPageShow() {
      if (document.visibilityState === "visible") visibleSince ??= performance.now();
    }

    measure();
    measureNow.current = measure;
    const passive = { capture: true, passive: true } as const;
    // Captured on window, so the pane's scrolls (which do not bubble) arrive too.
    addEventListener("scroll", onScroll, passive);
    addEventListener("keydown", onInput, passive);
    addEventListener("pointerdown", onInput, passive);
    addEventListener("pointermove", onInput, passive);
    document.addEventListener("visibilitychange", onVisibility);
    addEventListener("pagehide", onPageHide);
    addEventListener("pageshow", onPageShow);
    return () => {
      removeEventListener("scroll", onScroll, passive);
      removeEventListener("keydown", onInput, passive);
      removeEventListener("pointerdown", onInput, passive);
      removeEventListener("pointermove", onInput, passive);
      document.removeEventListener("visibilitychange", onVisibility);
      removeEventListener("pagehide", onPageHide);
      removeEventListener("pageshow", onPageShow);
      if (timer) clearTimeout(timer);
      send();
    };
  }, [articleId, refs.pane, refs.main]);
}
