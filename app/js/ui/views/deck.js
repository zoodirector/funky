/** Deck detail: study button, note browser, deck actions. */

import { html, mount, on, pluralise } from "../dom.js";
import { navigate } from "../router.js";
import { setFlush, setHeader } from "../shell.js";
import { confirmDialog, customDialog, promptDialog } from "../components/dialog.js";
import { toast } from "../components/toast.js";
import * as store from "../../core/store.js";
import { deckCounts } from "../../core/queue.js";
import { DEFAULT_DECK_SETTINGS } from "../../core/model.js";
import { shareDeckById } from "./decks.js";

/** Filter state is per visit, not persisted — a search is a passing intent. */
let filter = { text: "", tag: "" };

function matches(note, { text, tag }) {
  if (tag && !note.tags.includes(tag)) return false;
  if (!text) return true;
  const needle = text.toLowerCase();
  return [note.term, note.translation, note.example, note.note]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

function noteRow(note) {
  return html`<button type="button" class="note-row" data-note="${note.id}">
    <span class="grow">
      <span class="note-term">${note.term || "—"}</span>
      <span class="note-translation" style="display:block">${note.translation || "—"}</span>
      ${note.tags.length
        ? html`<span class="note-tags"
            >${note.tags.map((tag) => html`<span class="badge badge-secondary">${tag}</span>`)}</span
          >`
        : ""}
    </span>
    <span class="deck-chevron" aria-hidden="true">›</span>
  </button>`;
}

async function editDeckSettings(deck) {
  const current = { ...DEFAULT_DECK_SETTINGS, ...deck.settings };

  const value = await customDialog({
    sheet: true,
    markup: html`<form method="dialog" class="dialog-body">
      <h2 class="dialog-title">Deck options</h2>
      <div>
        <label class="label" for="s-new">New cards per day</label>
        <input class="input" id="s-new" name="newPerDay" type="number" min="0" max="9999"
          value="${current.newPerDay}" inputmode="numeric" />
      </div>
      <div>
        <label class="label" for="s-rev">Maximum reviews per day</label>
        <input class="input" id="s-rev" name="reviewsPerDay" type="number" min="0" max="9999"
          value="${current.reviewsPerDay}" inputmode="numeric" />
      </div>
      <div>
        <label class="label" for="s-ret">Desired retention</label>
        <input class="input" id="s-ret" name="desiredRetention" type="number" min="0.7" max="0.98"
          step="0.01" value="${current.desiredRetention}" inputmode="decimal" />
        <p class="field-hint">
          How much you want to remember. Higher means shorter intervals and more reviews. 0.9 is
          the recommended default.
        </p>
      </div>
      <div>
        <label class="label" for="s-steps">Learning steps (minutes)</label>
        <input class="input" id="s-steps" name="learningSteps" value="${current.learningSteps.join(" ")}"
          inputmode="numeric" />
        <p class="field-hint">Shown this many minutes apart before the card graduates.</p>
      </div>
      <div>
        <label class="label" for="s-resteps">Relearning steps (minutes)</label>
        <input class="input" id="s-resteps" name="relearningSteps"
          value="${current.relearningSteps.join(" ")}" inputmode="numeric" />
      </div>
      <div class="dialog-actions">
        <button class="btn btn-outline" value="cancel" formnovalidate>Cancel</button>
        <button class="btn btn-default" value="confirm">Save</button>
      </div>
    </form>`,
    setup: (node, close) => {
      node.querySelector("form").addEventListener("submit", (event) => {
        // Without this the dialog would close with the button's own value and
        // the field contents would be lost.
        event.preventDefault();
        if (event.submitter?.value !== "confirm") return close("cancel");
        close(JSON.stringify(Object.fromEntries(new FormData(event.target))));
      });
    },
  });

  if (!value || value === "cancel") return;

  const parsed = JSON.parse(value);
  const steps = (input, fallback) => {
    const list = String(input)
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0);
    return list.length ? list : fallback;
  };

  await store.updateDeck(deck.id, {
    settings: {
      newPerDay: Math.max(0, Number(parsed.newPerDay) || 0),
      reviewsPerDay: Math.max(0, Number(parsed.reviewsPerDay) || 0),
      desiredRetention: Math.min(0.98, Math.max(0.7, Number(parsed.desiredRetention) || 0.9)),
      learningSteps: steps(parsed.learningSteps, DEFAULT_DECK_SETTINGS.learningSteps),
      relearningSteps: steps(parsed.relearningSteps, DEFAULT_DECK_SETTINGS.relearningSteps),
    },
  });
  toast("Deck options saved.");
}

export function render({ params, outlet }) {
  const deck = store.getDeck(params.id);
  if (!deck) {
    navigate("/decks", { replace: true });
    return;
  }

  const now = Date.now();
  const cards = store.cardsOfDeck(deck.id);
  const counts = deckCounts(cards, now, store.deckSettings(deck.id), store.todayTally(deck.id, now));
  const allNotes = store.notesOfDeck(deck.id);
  const tags = store.tagsOfDeck(deck.id);

  setFlush(false);
  setHeader({
    title: deck.name,
    back: "/decks",
    actions: [
      { label: "Send deck", icon: "↗", onClick: () => shareDeckById(deck.id) },
      { label: "Deck menu", icon: "⋯", onClick: () => openMenu(deck) },
    ],
  });

  mount(
    outlet,
    html`<div class="section">
        <div class="card">
          <div class="card-body stack">
            <div class="row" style="justify-content: center; gap: 0.375rem">
              <span class="badge badge-new">${counts.new} new</span>
              <span class="badge badge-learn">${counts.learning} learning</span>
              <span class="badge badge-due">${counts.review} due</span>
            </div>
            <button
              type="button"
              class="btn btn-default btn-lg btn-block"
              data-study
              ${counts.pending ? "" : "disabled"}
            >
              ${counts.pending ? `Study ${counts.pending}` : "Nothing due today"}
            </button>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="row-between">
          <p class="section-title">${pluralise(allNotes.length, "note")}</p>
          <button type="button" class="btn btn-secondary btn-sm" data-add>＋ Add note</button>
        </div>

        ${allNotes.length
          ? html`<div class="search-bar stack-sm">
              <input
                class="input"
                type="search"
                placeholder="Search notes"
                value="${filter.text}"
                data-search
                aria-label="Search notes"
              />
              ${tags.length
                ? html`<div class="row" style="flex-wrap: wrap; gap: 0.25rem">
                    <button
                      type="button"
                      class="badge ${filter.tag ? "badge-outline" : "badge-secondary"}"
                      data-tag=""
                    >
                      all
                    </button>
                    ${tags.map(
                      (tag) => html`<button
                        type="button"
                        class="badge ${filter.tag === tag ? "badge-secondary" : "badge-outline"}"
                        data-tag="${tag}"
                      >
                        ${tag}
                      </button>`
                    )}
                  </div>`
                : ""}
            </div>`
          : ""}

        <div data-note-list></div>
      </div>`
  );

  // Only the list is repainted while filtering: rebuilding the whole view on
  // every keystroke would blur the search field mid-word.
  const listContainer = outlet.querySelector("[data-note-list]");

  const paintList = () => {
    const visible = allNotes.filter((note) => matches(note, filter));
    mount(
      listContainer,
      visible.length
        ? html`<div class="card note-list">${visible.map(noteRow)}</div>`
        : html`<div class="empty">
            <span class="empty-icon" aria-hidden="true">✍️</span>
            <p class="empty-title">
              ${allNotes.length ? "Nothing matches that search" : "No notes yet"}
            </p>
            <p>${allNotes.length ? "Try a different word or tag." : "Add your first card."}</p>
          </div>`
    );
  };

  const paintTags = () => {
    for (const button of outlet.querySelectorAll("[data-tag]")) {
      const active = button.dataset.tag === filter.tag;
      button.className = `badge ${active ? "badge-secondary" : "badge-outline"}`;
    }
  };

  paintList();

  const teardowns = [
    on(outlet, "click", "[data-study]", () => navigate(`/review/${deck.id}`)),
    on(outlet, "click", "[data-add]", () => navigate(`/deck/${deck.id}/note/new`)),
    on(outlet, "click", "[data-note]", (_event, element) =>
      navigate(`/deck/${deck.id}/note/${element.dataset.note}`)
    ),
    on(outlet, "click", "[data-tag]", (_event, element) => {
      filter = { ...filter, tag: element.dataset.tag };
      paintTags();
      paintList();
    }),
    on(outlet, "input", "[data-search]", (event) => {
      filter = { ...filter, text: event.target.value };
      paintList();
    }),
  ];

  return () => {
    teardowns.forEach((fn) => fn());
    filter = { text: "", tag: "" };
  };
}

async function openMenu(deck) {
  const choice = await customDialog({
    sheet: true,
    markup: html`<form method="dialog" class="dialog-body">
      <h2 class="dialog-title">${deck.name}</h2>
      <button class="btn btn-outline btn-block" value="rename">Rename deck</button>
      <button class="btn btn-outline btn-block" value="languages">Set languages</button>
      <button class="btn btn-outline btn-block" value="options">Deck options</button>
      <button class="btn btn-outline btn-block" value="share">Send to a friend</button>
      <button class="btn btn-destructive btn-block" value="delete">Delete deck</button>
      <button class="btn btn-ghost btn-block" value="cancel">Cancel</button>
    </form>`,
  });

  if (choice === "rename") {
    const name = await promptDialog({
      title: "Rename deck",
      label: "Deck name",
      value: deck.name,
    });
    if (name) await store.updateDeck(deck.id, { name });
  }

  if (choice === "languages") {
    const front = await promptDialog({
      title: "Front language",
      label: "Shown on the term side",
      value: deck.frontLang,
      placeholder: "Sursilvan",
    });
    if (front === null) return;
    const back = await promptDialog({
      title: "Back language",
      label: "Shown on the translation side",
      value: deck.backLang,
      placeholder: "German",
    });
    if (back === null) return;
    await store.updateDeck(deck.id, { frontLang: front, backLang: back });
  }

  if (choice === "options") await editDeckSettings(deck);
  if (choice === "share") await shareDeckById(deck.id);

  if (choice === "delete") {
    const confirmed = await confirmDialog({
      title: `Delete "${deck.name}"?`,
      description:
        "This deletes the deck, its notes and your progress on this device. If you have sent the deck to someone, their copy is unaffected.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (confirmed) {
      await store.deleteDeck(deck.id);
      toast("Deck deleted.");
      navigate("/decks");
    }
  }
}
