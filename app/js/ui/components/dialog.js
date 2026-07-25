/**
 * Modals built on the native <dialog> element, which brings focus trapping,
 * Escape-to-close, inertness of the page behind, and the ::backdrop for free.
 */

import { html, render } from "../dom.js";

function open(node) {
  document.body.append(node);
  node.showModal();
  return new Promise((resolve) => {
    node.addEventListener("close", () => {
      const value = node.returnValue;
      node.remove();
      resolve(value);
    });
  });
}

/**
 * Confirmation. Resolves true only if the confirm button was used — closing
 * with Escape or the backdrop counts as "no", which is the safe default for
 * the destructive actions this is mostly used for.
 */
export async function confirmDialog({
  title,
  description = "",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
}) {
  const node = render(
    html`<dialog class="dialog" aria-labelledby="dlg-title">
      <form method="dialog" class="dialog-body">
        <h2 class="dialog-title" id="dlg-title">${title}</h2>
        ${description ? html`<p class="dialog-desc">${description}</p>` : ""}
        <div class="dialog-actions">
          <button class="btn btn-outline" value="cancel">${cancelLabel}</button>
          <button class="btn ${destructive ? "btn-destructive" : "btn-default"}" value="confirm">
            ${confirmLabel}
          </button>
        </div>
      </form>
    </dialog>`
  ).firstElementChild;

  const promise = open(node);
  // Focus the safe choice, so a stray Enter cannot delete a deck.
  node.querySelector('[value="cancel"]').focus();
  return (await promise) === "confirm";
}

/**
 * A single-field prompt. Resolves the trimmed value, or null if cancelled.
 */
export async function promptDialog({
  title,
  label,
  value = "",
  placeholder = "",
  confirmLabel = "Save",
}) {
  const node = render(
    html`<dialog class="dialog" aria-labelledby="dlg-title">
      <form method="dialog" class="dialog-body">
        <h2 class="dialog-title" id="dlg-title">${title}</h2>
        <div>
          <label class="label" for="dlg-input">${label}</label>
          <input
            class="input"
            id="dlg-input"
            name="value"
            value="${value}"
            placeholder="${placeholder}"
            autocomplete="off"
          />
        </div>
        <div class="dialog-actions">
          <button class="btn btn-outline" value="cancel" formnovalidate>Cancel</button>
          <button class="btn btn-default" value="confirm">${confirmLabel}</button>
        </div>
      </form>
    </dialog>`
  ).firstElementChild;

  const input = node.querySelector("input");
  queueMicrotask(() => {
    input.focus();
    input.select();
  });

  const result = await open(node);
  return result === "confirm" ? input.value.trim() : null;
}

/**
 * A custom dialog: caller supplies the body markup and wires it up in `setup`,
 * which receives the dialog node and a `close(value)` function.
 *
 * Note for callers with a form: a `method="dialog"` form sets `returnValue`
 * from the submit button itself, overwriting anything you assign during the
 * submit event. To return something richer, call `preventDefault()` and use
 * the supplied `close(value)`.
 */
export function customDialog({ markup, setup, sheet = false }) {
  const node = render(
    html`<dialog class="dialog ${sheet ? "dialog-sheet" : ""}">${markup}</dialog>`
  ).firstElementChild;

  const promise = open(node);
  setup?.(node, (value) => node.close(value));
  return promise;
}
