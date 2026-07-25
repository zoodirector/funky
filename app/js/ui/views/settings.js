/** App settings, storage information, and the reset escape hatch. */

import { html, mount, on } from "../dom.js";
import { refresh } from "../router.js";
import { setFlush, setHeader } from "../shell.js";
import { confirmDialog } from "../components/dialog.js";
import { toast } from "../components/toast.js";
import * as store from "../../core/store.js";
import { storageEstimate } from "../../core/db.js";
import { applyTheme } from "../theme.js";

const THEMES = [
  { value: "system", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export async function render({ outlet }) {
  setFlush(false);
  setHeader({ title: "Settings" });

  const settings = store.getState().settings;
  const estimate = await storageEstimate();
  const decks = store.listDecks();
  const noteCount = [...store.getState().notes.values()].filter((n) => !n.deleted).length;
  const cardCount = store.getState().cards.size;

  mount(
    outlet,
    html`<div class="section">
        <p class="section-title">Appearance</p>
        <div class="card setting-list">
          <div class="setting-row">
            <div class="setting-main">
              <div class="setting-title">Theme</div>
              <div class="setting-desc">Auto follows your device.</div>
            </div>
            <div class="theme-toggle" role="group" aria-label="Theme">
              ${THEMES.map(
                (theme) => html`<button
                  type="button"
                  data-theme="${theme.value}"
                  aria-pressed="${String(settings.theme === theme.value)}"
                >
                  ${theme.label}
                </button>`
              )}
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-main">
              <div class="setting-title">Show next interval on buttons</div>
              <div class="setting-desc">Each answer shows when the card returns.</div>
            </div>
            <button
              type="button"
              class="switch"
              role="switch"
              data-toggle="showIntervalPreview"
              aria-checked="${String(settings.showIntervalPreview)}"
              aria-label="Show next interval on buttons"
            ></button>
          </div>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Scheduling</p>
        <div class="card setting-list">
          <div class="setting-row">
            <div class="setting-main">
              <div class="setting-title">Next day starts at</div>
              <div class="setting-desc">
                Reviews before this hour still count towards the previous day.
              </div>
            </div>
            <select class="select setting-control" data-cutoff aria-label="Next day starts at">
              ${Array.from(
                { length: 24 },
                (_, hour) => html`<option value="${hour}" ${settings.dayCutoffHour === hour ? "selected" : ""}>
                  ${String(hour).padStart(2, "0")}:00
                </option>`
              )}
            </select>
          </div>
        </div>
        <p class="text-sm muted">
          Per-deck limits, learning steps and desired retention live in each deck's options.
        </p>
      </div>

      <div class="section">
        <p class="section-title">Storage</p>
        <div class="card">
          <div class="card-body stack-sm">
            <p class="text-sm">
              ${decks.length} decks · ${noteCount} notes · ${cardCount} cards
            </p>
            ${estimate?.usage != null
              ? html`<p class="text-sm muted">
                  Using ${(estimate.usage / 1024 / 1024).toFixed(1)} MB of
                  ${(estimate.quota / 1024 / 1024).toFixed(0)} MB available on this device.
                </p>`
              : ""}
            <p class="text-sm muted">
              Everything is stored in this browser only. Clearing site data removes it, so send a
              deck file to a friend now and then — that is your backup.
            </p>
          </div>
        </div>
      </div>

      <div class="section">
        <p class="section-title">Danger zone</p>
        <button type="button" class="btn btn-destructive btn-block" data-reset>
          Delete everything
        </button>
      </div>

      <p class="text-xs muted" style="margin-top: 1.5rem; text-align: center">
        Funky · scheduling by FSRS-5
      </p>`
  );

  const teardowns = [
    on(outlet, "click", "[data-theme]", async (_event, element) => {
      await store.updateSettings({ theme: element.dataset.theme });
      applyTheme(element.dataset.theme);
      refresh();
    }),

    on(outlet, "click", "[data-toggle]", async (_event, element) => {
      const key = element.dataset.toggle;
      const next = element.getAttribute("aria-checked") !== "true";
      element.setAttribute("aria-checked", String(next));
      await store.updateSettings({ [key]: next });
    }),

    on(outlet, "change", "[data-cutoff]", async (event) => {
      await store.updateSettings({ dayCutoffHour: Number(event.target.value) });
      toast("Day rollover updated.");
    }),

    on(outlet, "click", "[data-reset]", async () => {
      const confirmed = await confirmDialog({
        title: "Delete everything?",
        description:
          "All decks, notes and review history on this device are removed. Decks you have already sent to other people are unaffected. This cannot be undone.",
        confirmLabel: "Delete everything",
        destructive: true,
      });
      if (!confirmed) return;
      await store.resetEverything();
      toast("All local data deleted.");
      refresh();
    }),
  ];

  return () => teardowns.forEach((fn) => fn());
}
