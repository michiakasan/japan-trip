// Small helpers for working with the page (the "DOM").

/** Find one element by CSS selector. Throws a clear error if it is missing. */
export function $<T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);
  return el;
}

/**
 * Escape text before putting it inside HTML.
 * Without this, a name like "Irabu & Shimoji" or a note containing "<" could break the page.
 * Use it on EVERY piece of data you put into a template string.
 */
export function esc(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/** Show a short message at the bottom of the screen for a few seconds. */
let toastTimer: number | undefined;
export function toast(message: string) {
  let el = document.querySelector<HTMLElement>("#toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    el.setAttribute("role", "status");
    document.body.append(el);
  }
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el!.hidden = true), 2600);
}
