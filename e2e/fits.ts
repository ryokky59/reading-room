import type { Locator, Page } from "./test";

/**
 * What scrolls sideways or hides text sideways, one string per frame (tag, first classes, px), so
 * `expect(await sideOverflows(page)).toEqual([])` names the frame when it fails.
 *
 * The page itself counts when it scrolls sideways. So does every drawn element that clips or
 * scrolls (`overflow-x` not `visible`) and is wider inside than its box: a list pane, a Board
 * column or an `overflow-x: clip` wrapper keeps what spills out of it away from the page's
 * `scrollWidth`, so checking the page alone misses a card wider than its pane (#159).
 *
 * Frames that cut or scroll sideways on purpose are left out: `text-overflow: ellipsis`
 * (`truncate`), the chip row (`ul.chip-row`), the row of Board columns (`board:overflow-x-auto`),
 * and `pre` and `table` in an article's text (`.prose-read`). Sizes only, not positions: an
 * article sheet sliding in from the right (`sheet-in`) has a transform that does not change them.
 */
export const sideOverflows = (page: Page) =>
  page.evaluate(() => {
    const found: string[] = [];
    const whole = document.documentElement.scrollWidth - window.innerWidth;
    if (whole > 0) found.push(`page ${whole}px`);
    for (const el of [document.body, ...document.body.querySelectorAll<HTMLElement>("*")]) {
      if (el.clientWidth === 0) continue;
      const style = getComputedStyle(el);
      if (style.overflowX === "visible") continue;
      if (style.textOverflow === "ellipsis") continue;
      if (el.matches("ul.chip-row, .prose-read pre, .prose-read table")) continue;
      if (el.classList.contains("board:overflow-x-auto")) continue;
      const over = el.scrollWidth - el.clientWidth;
      // 1px for fractional widths.
      if (over > 1) {
        const classes = [...el.classList].slice(0, 3).join(".");
        found.push(`${el.tagName.toLowerCase()}${classes ? `.${classes}` : ""} ${over}px`);
      }
    }
    return found;
  });

/** How far the page scrolls sideways (0 or less when it does not): what the specs checked before sideOverflows. */
export const pageOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/**
 * For a control of sideOverflows: keeps a line of text from wrapping and pushes it far to the
 * right, so it spills out of its frame. A `line-clamp` element clips itself; it is made a plain
 * block first, so what catches the spill is the frame around it. `unwiden` puts it back.
 */
export const widen = (text: Locator) =>
  text.evaluate((el) => {
    el.style.display = "block";
    el.style.overflow = "visible";
    el.style.whiteSpace = "nowrap";
    el.style.paddingLeft = "4000px";
  });

export const unwiden = (text: Locator) =>
  text.evaluate((el) => {
    el.style.display = "";
    el.style.overflow = "";
    el.style.whiteSpace = "";
    el.style.paddingLeft = "";
  });
