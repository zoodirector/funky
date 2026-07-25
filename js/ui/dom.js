/**
 * The whole of our "framework": a tagged template that builds DOM, plus a few
 * helpers. No virtual DOM, no reactivity — views render their subtree and the
 * router swaps it in.
 *
 * Interpolated values are escaped by default, which is the only reason it is
 * safe to build markup from note text a friend sent you.
 */

const escapeMap = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => escapeMap[ch]);

/** Opt out of escaping for markup you built yourself. */
export class Raw {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

export const raw = (value) => new Raw(value);

function interpolate(value) {
  // `false` renders as nothing so `${condition && html`…`}` reads naturally.
  // The cost is that a boolean in an attribute needs an explicit String().
  if (value == null || value === false) return "";
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(interpolate).join("");
  return escapeHtml(value);
}

/** Build an HTML string with escaping. */
export function html(strings, ...values) {
  return raw(strings.reduce((out, part, i) => out + part + interpolate(values[i]), ""));
}

/** Build a DocumentFragment from an html`` result (or a plain string). */
export function render(markup) {
  const template = document.createElement("template");
  template.innerHTML = String(markup).trim();
  return template.content;
}

/** Replace an element's children with freshly rendered markup. */
export function mount(container, markup) {
  container.replaceChildren(render(markup));
  return container;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/**
 * Delegated event binding: one listener on a container, matched by selector.
 * Cheaper than re-binding handlers to every row on every render, and it keeps
 * working across re-renders.
 */
export function on(root, type, selector, handler) {
  const listener = (event) => {
    const target = event.target.closest(selector);
    if (target && root.contains(target)) handler(event, target);
  };
  root.addEventListener(type, listener);
  return () => root.removeEventListener(type, listener);
}

/** Read a form as a plain object. */
export function formValues(form) {
  const out = {};
  for (const [key, value] of new FormData(form)) out[key] = value;
  return out;
}

/** Relative time in the compact style used across the lists. */
export function formatRelative(timestamp, now = Date.now()) {
  const diff = timestamp - now;
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (abs < minute) return "now";
  if (abs < hour) return `${diff < 0 ? "" : "in "}${Math.round(abs / minute)}m${diff < 0 ? " ago" : ""}`;
  if (abs < day) return `${diff < 0 ? "" : "in "}${Math.round(abs / hour)}h${diff < 0 ? " ago" : ""}`;
  return `${diff < 0 ? "" : "in "}${Math.round(abs / day)}d${diff < 0 ? " ago" : ""}`;
}

export const pluralise = (n, singular, plural = `${singular}s`) =>
  `${n} ${n === 1 ? singular : plural}`;
