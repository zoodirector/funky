/**
 * The persistent chrome around the routed view: title bar and tab bar.
 * Views call `setHeader` on render rather than owning their own header, so the
 * bar never flickers or shifts between routes.
 */

import { $, html, mount, render } from "./dom.js";
import { currentPath, navigate } from "./router.js";

const TABS = [
  { path: "/decks", label: "Decks", icon: "🗂", match: /^\/(decks|deck|review)/ },
  { path: "/stats", label: "Stats", icon: "📈", match: /^\/stats/ },
  { path: "/settings", label: "Settings", icon: "⚙️", match: /^\/settings/ },
];

let header = null;
let tabbar = null;
let outlet = null;

export function initShell() {
  header = $("#app-header");
  tabbar = $("#app-tabbar");
  outlet = $("#app-outlet");

  mount(
    tabbar,
    html`${TABS.map(
      (tab) => html`<button type="button" class="tab" data-path="${tab.path}">
        <span class="tab-icon" aria-hidden="true">${tab.icon}</span>
        <span>${tab.label}</span>
      </button>`
    )}`
  );

  tabbar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-path]");
    if (button) navigate(button.dataset.path);
  });

  return { outlet };
}

export function syncTabs() {
  const path = currentPath();
  for (const button of tabbar.querySelectorAll(".tab")) {
    const tab = TABS.find((t) => t.path === button.dataset.path);
    if (tab?.match.test(path)) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
}

/**
 * @param {object} options
 * @param {string} options.title
 * @param {string|null} options.back path to navigate to, or null for no back button
 * @param {Array<{label: string, icon?: string, onClick: Function, variant?: string}>} options.actions
 * @param {boolean} options.tabs whether the tab bar is visible
 */
export function setHeader({ title, back = null, actions = [], tabs = true }) {
  mount(
    header,
    html`${back !== null
        ? html`<button type="button" class="btn btn-ghost btn-icon" data-back aria-label="Back">
            ←
          </button>`
        : ""}
      <h1 class="app-title">${title}</h1>
      <div class="app-header-actions"></div>`
  );

  const backButton = header.querySelector("[data-back]");
  if (backButton) backButton.addEventListener("click", () => navigate(back));

  const slot = header.querySelector(".app-header-actions");
  for (const action of actions) {
    const node = render(
      html`<button
        type="button"
        class="btn ${action.variant ?? "btn-ghost"} ${action.icon ? "btn-icon" : "btn-sm"}"
        aria-label="${action.label}"
      >
        ${action.icon ?? action.label}
      </button>`
    ).firstElementChild;
    node.addEventListener("click", action.onClick);
    slot.append(node);
  }

  tabbar.classList.toggle("hidden", !tabs);
  document.title = title === "Funky" ? title : `${title} · Funky`;
  syncTabs();
}

/** Views that own the full surface (review) opt out of the main padding. */
export function setFlush(flush) {
  outlet.classList.toggle("is-flush", flush);
}
