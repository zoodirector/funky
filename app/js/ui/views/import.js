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
import { customDialog } from "../components/dialog.js";
import * as store from "../../core/store.js";
import { acceptDrops, pasteDeck, pickDeckFile } from "../../core/share.js";
import { parsePayload } from "../../core/codec.js";
import { ADD_AS_NEW_DECK, MERGE_INTO_DECK, planMerge, suggestDeckAction } from "../../core/merge.js";

/** Payload handed over by the OS file handler before this view existed. */
let pendingPayload = null;

export const setPendingPayload = (payload) => {
  pendingPayload = payload;
};

/**
 * iOS gets its own instructions because it is the one platform where a deck
 * cannot come straight from the messenger — see the note in core/share.js.
 * iPadOS reports itself as a Mac, hence the touch-point check.
 */
const isIOS =
  typeof navigator !== "undefined" &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1));

/**
 * Manual paste, for when the clipboard cannot be read programmatically.
 * Resolves the parsed payload, or null if cancelled.
 */
async function pasteDialog() {
  let parsed = null;

  const result = await customDialog({
    markup: html`<div class="dialog-body">
      <h2 class="dialog-title">Paste a deck</h2>
      <p class="dialog-desc">
        Paste the whole deck text — it starts with <code>{</code> and ends with <code>}</code>.
      </p>
      <textarea
        class="textarea"
        rows="6"
        data-text
        placeholder="{ &quot;format&quot;: &quot;funky.deck&quot;, …"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
      ></textarea>
      <p class="field-hint" data-error hidden></p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-outline" data-cancel>Cancel</button>
        <button type="button" class="btn btn-default" data-ok>Open deck</button>
      </div>
    </div>`,
    setup(node, close) {
      const textarea = node.querySelector("[data-text]");
      const error = node.querySelector("[data-error]");
      queueMicrotask(() => textarea.focus());

      node.querySelector("[data-cancel]").addEventListener("click", () => close("cancel"));
      node.querySelector("[data-ok]").addEventListener("click", () => {
        try {
          parsed = parsePayload(textarea.value);
          close("ok");
        } catch (failure) {
          // Inline, not a toast: the text is still on screen to be corrected.
          error.textContent = failure.message;
          error.hidden = false;
        }
      });
    },
    // returnValue is a string, so the payload rides along in the closure.
  });

  return result === "ok" ? parsed : null;
}

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
          <div class="dropzone-actions">
            <button type="button" class="btn btn-default" data-pick>Choose file</button>
            <button type="button" class="btn btn-outline" data-paste>Paste deck</button>
          </div>
        </div>

        ${isIOS
          ? html`<div class="card">
              <div class="card-body stack-sm">
                <h2 class="card-title">Coming from a messenger?</h2>
                <p class="text-sm muted">
                  iPhones do not let an app added to the home screen appear in the share sheet, so
                  Funky will not be in the list. Two steps instead:
                </p>
                <ol class="steps text-sm">
                  <li>
                    In the messenger, tap the deck file, then <strong>Share</strong> →
                    <strong>Save to Files</strong>.
                  </li>
                  <li>Come back here, tap <strong>Choose file</strong>, and pick it.</li>
                </ol>
                <p class="text-sm muted">
                  If the deck arrived as a message rather than a file, copy the text and use
                  <strong>Paste deck</strong>.
                </p>
              </div>
            </div>`
          : ""}

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

  /**
   * Try the clipboard first — one tap when it works — and fall back to a
   * textarea when the browser will not hand it over.
   */
  async function paste() {
    let parsed;
    try {
      parsed = await pasteDeck();
    } catch (error) {
      toastError(error); // clipboard held something, but not a deck
      return;
    }
    parsed ??= await pasteDialog();
    if (!parsed) return;
    payload = parsed;
    target = null;
    paint();
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
    on(outlet, "click", "[data-paste]", paste),
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
