/**
 * Entry point: open the database, register the routes, start the router.
 */

import * as store from "./core/store.js";
import { onLaunchWithFile } from "./core/share.js";
import { html, mount } from "./ui/dom.js";
import { navigate, route, start } from "./ui/router.js";
import { initShell } from "./ui/shell.js";
import { applyTheme } from "./ui/theme.js";
import { toast, toastError } from "./ui/components/toast.js";

import * as decksView from "./ui/views/decks.js";
import * as deckView from "./ui/views/deck.js";
import * as reviewView from "./ui/views/review.js";
import * as noteEditorView from "./ui/views/note-editor.js";
import * as importView from "./ui/views/import.js";
import * as statsView from "./ui/views/stats.js";
import * as settingsView from "./ui/views/settings.js";

route("/decks", decksView);
route("/deck/:id", deckView);
route("/deck/:id/note/:noteId", noteEditorView);
route("/review/:id", reviewView);
route("/import", importView);
route("/stats", statsView);
route("/settings", settingsView);

async function main() {
  const { outlet } = initShell();

  try {
    await store.init();
  } catch (error) {
    mount(
      outlet,
      html`<div class="empty">
        <span class="empty-icon" aria-hidden="true">⚠️</span>
        <p class="empty-title">Storage is unavailable</p>
        <p>
          Funky needs IndexedDB to keep your cards. Private browsing windows in some
          browsers block it.
        </p>
        <p class="text-xs muted">${error.message}</p>
      </div>`
    );
    return;
  }

  applyTheme(store.getState().settings.theme);

  if (!location.hash) navigate("/decks", { replace: true });
  await start({ outlet });

  // A deck file opened from the OS ("open with") lands here.
  onLaunchWithFile((payload, error) => {
    if (error) return toastError(error);
    if (!payload) return;
    importView.setPendingPayload(payload);
    navigate("/import");
  });

  registerServiceWorker();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  // A page opened over file:// or plain http on a LAN address cannot register
  // a worker; the app still works, it just is not installable.
  if (!isSecureContext) return;

  navigator.serviceWorker.register("sw.js").then((registration) => {
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      installing?.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          toast("A new version is ready.", {
            duration: 8000,
            action: {
              label: "Reload",
              onClick: () => {
                installing.postMessage({ type: "skip-waiting" });
                location.reload();
              },
            },
          });
        }
      });
    });
  }, () => {
    // Registration failure is not worth interrupting anyone over.
  });
}

main();
