/** Transient messages. One container, appended to on demand. */

import { html, render } from "../dom.js";

let container = null;

function ensureContainer() {
  if (container?.isConnected) return container;
  container = document.createElement("div");
  container.className = "toaster";
  // Announced politely so a screen reader hears "Deck shared" without having
  // focus yanked out of whatever the user was doing.
  container.setAttribute("role", "status");
  container.setAttribute("aria-live", "polite");
  document.body.append(container);
  return container;
}

/**
 * @param {string} message
 * @param {{ duration?: number, variant?: "default"|"error",
 *           action?: { label: string, onClick: () => void } }} options
 */
export function toast(message, { duration = 3200, variant = "default", action } = {}) {
  const root = ensureContainer();
  const node = render(
    html`<div class="toast ${variant === "error" ? "toast-error" : ""}">
      <span class="grow">${message}</span>
      ${action ? html`<button type="button" class="toast-action">${action.label}</button>` : ""}
    </div>`
  ).firstElementChild;

  const dismiss = () => {
    if (!node.isConnected) return;
    node.classList.add("is-leaving");
    node.addEventListener("animationend", () => node.remove(), { once: true });
  };

  if (action) {
    node.querySelector(".toast-action").addEventListener("click", () => {
      action.onClick();
      dismiss();
    });
  }

  root.append(node);
  const timer = setTimeout(dismiss, duration);
  node.addEventListener("click", () => clearTimeout(timer), { once: true });

  return dismiss;
}

export const toastError = (error) =>
  toast(error?.message ?? String(error), { variant: "error", duration: 5000 });
