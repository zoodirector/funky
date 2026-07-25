/** Deck list — the app's home screen. */

import { html, mount, on, pluralise } from "../dom.js";
import { navigate } from "../router.js";
import { setFlush, setHeader } from "../shell.js";
import { promptDialog } from "../components/dialog.js";
import { toast, toastError } from "../components/toast.js";
import * as store from "../../core/store.js";
import { deckCounts } from "../../core/queue.js";
import { shareDeck } from "../../core/share.js";

function deckRow(deck, now) {
  const cards = store.cardsOfDeck(deck.id);
  const counts = deckCounts(cards, now, store.deckSettings(deck.id), store.todayTally(deck.id, now));
  const noteCount = store.notesOfDeck(deck.id).length;

  const badges = [
    counts.new ? html`<span class="badge badge-new">${counts.new}</span>` : "",
    counts.learning ? html`<span class="badge badge-learn">${counts.learning}</span>` : "",
    counts.review ? html`<span class="badge badge-due">${counts.review}</span>` : "",
    counts.pending ? "" : html`<span class="badge badge-outline">done</span>`,
  ];

  return html`<div class="card">
    <button type="button" class="card-link deck-row" data-deck="${deck.id}">
      <span class="deck-row-main">
        <span class="deck-name">${deck.name}</span>
        <span class="deck-meta"
          >${pluralise(noteCount, "note")}${deck.frontLang && deck.backLang
            ? ` · ${deck.frontLang} → ${deck.backLang}`
            : ""}</span
        >
      </span>
      <span class="deck-counts">${badges}</span>
      <span class="deck-chevron" aria-hidden="true">›</span>
    </button>
  </div>`;
}

async function createDeck() {
  const name = await promptDialog({
    title: "New deck",
    label: "Deck name",
    placeholder: "Sursilvan",
    confirmLabel: "Create",
  });
  if (!name) return;
  const deck = await store.addDeck({ name });
  navigate(`/deck/${deck.id}`);
}

export function render({ outlet }) {
  const now = Date.now();
  const decks = store.listDecks();

  setFlush(false);
  setHeader({
    title: "Funky",
    actions: [
      { label: "Import a deck", icon: "⤓", onClick: () => navigate("/import") },
      { label: "New deck", icon: "＋", onClick: createDeck },
    ],
  });

  const totals = decks.reduce(
    (sum, deck) => {
      const counts = deckCounts(
        store.cardsOfDeck(deck.id),
        now,
        store.deckSettings(deck.id),
        store.todayTally(deck.id, now)
      );
      return { pending: sum.pending + counts.pending };
    },
    { pending: 0 }
  );

  mount(
    outlet,
    decks.length
      ? html`<div class="section">
          <p class="section-title">
            ${totals.pending ? `${pluralise(totals.pending, "card")} waiting` : "Nothing due today"}
          </p>
          <div class="list">${decks.map((deck) => deckRow(deck, now))}</div>
        </div>`
      : html`<div class="empty">
          <span class="empty-icon" aria-hidden="true">🗂</span>
          <p class="empty-title">No decks yet</p>
          <p>Create one, or import a deck a friend sent you.</p>
          <div class="row" style="margin-top: 0.75rem">
            <button type="button" class="btn btn-default" data-new>New deck</button>
            <button type="button" class="btn btn-outline" data-import>Import</button>
          </div>
        </div>`
  );

  const teardowns = [
    on(outlet, "click", "[data-deck]", (_event, element) =>
      navigate(`/deck/${element.dataset.deck}`)
    ),
    on(outlet, "click", "[data-new]", createDeck),
    on(outlet, "click", "[data-import]", () => navigate("/import")),
  ];

  return () => teardowns.forEach((fn) => fn());
}

/** Shared by the deck list and deck detail views. */
export async function shareDeckById(deckId) {
  const deck = store.getDeck(deckId);
  if (!deck) return;
  const notes = store.notesOfDeck(deckId, { includeDeleted: true });
  try {
    const result = await shareDeck(deck, notes);
    if (result === "shared") toast("Deck shared.");
    if (result === "downloaded") toast("Deck saved to your downloads.");
  } catch (error) {
    toastError(error);
  }
}
