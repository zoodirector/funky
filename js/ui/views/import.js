/**
 * Importing a deck a friend sent.
 *
 * Nothing is written until the user has seen exactly what will change. The
 * report is the whole point of this screen: "12 new, 3 updated, your progress
 * untouched" is the difference between a merge people trust and one they don't.
 */

import { html, mount, on, pluralise } from "../dom.js";
import { navigate } from "../router.js";
import { setFlush, setHeader } from "../shell.js";
import { toast, toastError } from "../components/toast.js";
import * as store from "../../core/store.js";
import { acceptDrops, pickDeckFile } from "../../core/share.js";
import { ADD_AS_NEW_DECK, MERGE_INTO_DECK, planMerge, suggestDeckAction } from "../../core/merge.js";

/** Payload handed over by the OS file handler before this view existed. */
let pendingPayload = null;

export const setPendingPayload = (payload) => {
  pendingPayload = payload;
};

export function render({ outlet }) {
  let payload = pendingPayload;
  pendingPayload = null;
  let target = null; // { action, deck }

  setFlush(false);
  setHeader({ title: "Import a deck", back: "/decks", tabs: true });

  function paint() {
    if (!payload) {
      paintPicker();
      return;
    }
    paintReport();
  }

  function paintPicker() {
    mount(
      outlet,
      html`<div class="section">
        <div class="dropzone" data-dropzone>
          <span class="empty-icon" aria-hidden="true">📥</span>
          <p class="empty-title">Open a deck file</p>
          <p class="text-sm">
            Save the <code>.json</code> file your friend sent, then choose it here.
          </p>
          <button type="button" class="btn btn-default" data-pick style="margin-top: 0.5rem">
            Choose file
          </button>
        </div>

        <div class="card">
          <div class="card-body stack-sm">
            <h2 class="card-title">How sharing works</h2>
            <p class="text-sm muted">
              A deck file holds only the cards — never your review history. When you import,
              new cards are added, cards you both changed take the newer version, and everything
              you have already learned keeps its schedule.
            </p>
            <p class="text-sm muted">
              Both of you can import each other's files as often as you like; the result is the
              same either way round.
            </p>
          </div>
        </div>
      </div>`
    );
  }

  function paintReport() {
    const suggestion = target ?? suggestDeckAction(store.listDecks(), payload);
    target = suggestion;

    const targetDeckId = suggestion.action === MERGE_INTO_DECK ? suggestion.deck.id : payload.deck.id;
    const localNotes =
      suggestion.action === MERGE_INTO_DECK
        ? store.notesOfDeck(suggestion.deck.id, { includeDeleted: true })
        : [];

    const { report } = planMerge(localNotes, payload, { targetDeckId });
    const decks = store.listDecks();

    mount(
      outlet,
      html`<div class="section">
        <div class="card">
          <div class="card-body stack-sm">
            <h2 class="card-title">${payload.deck.name}</h2>
            <p class="text-sm muted">
              ${pluralise(report.noteCount, "note")}${report.exportedAt
                ? ` · exported ${new Date(report.exportedAt).toLocaleDateString([], {
                    dateStyle: "medium",
                  })}`
                : ""}
            </p>
          </div>
        </div>

        <div>
          <label class="label" for="target">Merge into</label>
          <select class="select" id="target" data-target ${suggestion.forced ? "disabled" : ""}>
            <option value="__new__" ${suggestion.action === ADD_AS_NEW_DECK ? "selected" : ""}>
              New deck — "${payload.deck.name}"
            </option>
            ${decks.map(
              (deck) => html`<option
                value="${deck.id}"
                ${suggestion.action === MERGE_INTO_DECK && suggestion.deck.id === deck.id
                  ? "selected"
                  : ""}
              >
                ${deck.name}
              </option>`
            )}
          </select>
          ${suggestion.forced
            ? html`<p class="field-hint">
                This is the same deck you already have, so it merges in place.
              </p>`
            : ""}
        </div>

        <div class="report-grid">
          <div class="report-stat">
            <div class="report-stat-value">${report.added}</div>
            <div class="report-stat-label">new cards added</div>
          </div>
          <div class="report-stat">
            <div class="report-stat-value">${report.updated}</div>
            <div class="report-stat-label">cards updated</div>
          </div>
          <div class="report-stat">
            <div class="report-stat-value">${report.unchanged}</div>
            <div class="report-stat-label">already up to date</div>
          </div>
          <div class="report-stat">
            <div class="report-stat-value">${report.deleted}</div>
            <div class="report-stat-label">deleted by sender</div>
          </div>
        </div>

        ${report.duplicates.length
          ? html`<div class="card">
              <div class="card-body stack-sm">
                <h2 class="card-title">
                  ${pluralise(report.duplicates.length, "possible duplicate")}
                </h2>
                <p class="text-sm muted">
                  These look like cards you both wrote separately. They will be added as separate
                  cards — delete whichever you prefer afterwards.
                </p>
                <div class="report-samples">
                  ${report.duplicates
                    .slice(0, 20)
                    .map(
                      (dupe) => html`<span
                        >${dupe.incoming.term} — ${dupe.incoming.translation}</span
                      >`
                    )}
                </div>
              </div>
            </div>`
          : ""}

        <p class="text-sm muted">
          Your own progress is never changed by an import. Cards new to you start unlearned.
        </p>

        <button type="button" class="btn btn-default btn-lg btn-block" data-apply>
          ${report.added + report.updated + report.deleted === 0
            ? "Nothing to import"
            : `Import into ${suggestion.action === MERGE_INTO_DECK ? suggestion.deck.name : "a new deck"}`}
        </button>
        <button type="button" class="btn btn-ghost btn-block" data-cancel>Choose a different file</button>
      </div>`
    );
  }

  async function pick() {
    try {
      const parsed = await pickDeckFile();
      if (!parsed) return;
      payload = parsed;
      target = null;
      paint();
    } catch (error) {
      toastError(error);
    }
  }

  async function apply() {
    const suggestion = target;
    const targetDeckId =
      suggestion.action === MERGE_INTO_DECK ? suggestion.deck.id : payload.deck.id;
    const localNotes =
      suggestion.action === MERGE_INTO_DECK
        ? store.notesOfDeck(suggestion.deck.id, { includeDeleted: true })
        : [];

    const plan = planMerge(localNotes, payload, { targetDeckId });

    try {
      const result = await store.applyMerge({
        plan,
        deck: suggestion.action === MERGE_INTO_DECK ? suggestion.deck : null,
        createDeckFrom: suggestion.action === ADD_AS_NEW_DECK ? payload.deck : null,
      });
      toast(`Imported ${pluralise(plan.report.added + plan.report.updated, "card")}.`);
      navigate(`/deck/${result.deck.id}`);
    } catch (error) {
      toastError(error);
    }
  }

  paint();

  const stopDrops = acceptDrops(outlet, {
    onPayload: (parsed) => {
      payload = parsed;
      target = null;
      paint();
    },
    onError: toastError,
    onOver: (over) => outlet.querySelector("[data-dropzone]")?.classList.toggle("is-over", over),
  });

  const teardowns = [
    stopDrops,
    on(outlet, "click", "[data-pick]", pick),
    on(outlet, "click", "[data-apply]", apply),
    on(outlet, "click", "[data-cancel]", () => {
      payload = null;
      target = null;
      paint();
    }),
    on(outlet, "change", "[data-target]", (event) => {
      const value = event.target.value;
      target =
        value === "__new__"
          ? { action: ADD_AS_NEW_DECK, deck: null, forced: false }
          : { action: MERGE_INTO_DECK, deck: store.getDeck(value), forced: false };
      paint();
    }),
  ];

  return () => teardowns.forEach((fn) => fn());
}
