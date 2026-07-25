/**
 * The review session.
 *
 * The card on screen is always re-derived from live store state rather than
 * from a pre-built queue: answering "Again" makes a card due again in one
 * minute, and it must be able to come back within the same session.
 */

import { html, mount, on } from "../dom.js";
import { navigate } from "../router.js";
import { setFlush, setHeader } from "../shell.js";
import { toast, toastError } from "../components/toast.js";
import * as store from "../../core/store.js";
import { deckCounts, pickNext } from "../../core/queue.js";
import { formatInterval, previewIntervals } from "../../core/scheduler.js";
import { AGAIN, EASY, GOOD, HARD, RATING_LABELS } from "../../core/fsrs.js";
import { FORWARD, STATE_NEW, cardFaces } from "../../core/model.js";

export function render({ params, outlet }) {
  const deck = store.getDeck(params.id);
  if (!deck) {
    navigate("/decks", { replace: true });
    return;
  }

  let revealed = false;
  let current = null;
  let busy = false;
  let timer = null;

  setFlush(true);
  setHeader({
    title: deck.name,
    back: `/deck/${deck.id}`,
    tabs: false,
    actions: [{ label: "Undo last answer", icon: "↶", onClick: undo }],
  });

  function pick() {
    const now = Date.now();
    return pickNext(
      store.cardsOfDeck(deck.id),
      now,
      store.deckSettings(deck.id),
      store.todayTally(deck.id, now)
    );
  }

  function paint() {
    clearTimeout(timer);
    const now = Date.now();
    current = pick();

    if (!current) {
      paintDone(now);
      return;
    }

    const note = store.getNote(current.noteId);
    if (!note) {
      // A card whose note vanished (deleted in another tab) is not reviewable.
      paintDone(now);
      return;
    }

    const { front, back } = cardFaces(note, current);
    const counts = deckCounts(
      store.cardsOfDeck(deck.id),
      now,
      store.deckSettings(deck.id),
      store.todayTally(deck.id, now)
    );
    const previews = store.getState().settings.showIntervalPreview
      ? previewIntervals(current, now, store.deckSettings(deck.id))
      : null;

    const direction =
      current.direction === FORWARD
        ? deck.frontLang && deck.backLang
          ? `${deck.frontLang} → ${deck.backLang}`
          : "Recognise"
        : deck.frontLang && deck.backLang
          ? `${deck.backLang} → ${deck.frontLang}`
          : "Produce";

    mount(
      outlet,
      html`<div class="review">
        <div class="review-status">
          <span class="badge badge-new">${counts.new}</span>
          <span class="badge badge-learn">${counts.learning}</span>
          <span class="badge badge-due">${counts.review}</span>
        </div>

        <div class="review-stage" data-stage role="group" aria-label="Card">
          <p class="review-direction">${direction}</p>
          <p class="review-front">${front || "—"}</p>
          ${revealed
            ? html`<hr class="review-divider" />
                <p class="review-back">${back || "—"}</p>
                ${note.example ? html`<p class="review-example">${note.example}</p>` : ""}
                ${note.note ? html`<p class="review-note">${note.note}</p>` : ""}`
            : html`<p class="review-hint">Tap to show the answer</p>`}
        </div>

        <div class="review-actions">
          ${revealed
            ? html`<div class="rating-bar">
                ${[AGAIN, HARD, GOOD, EASY].map(
                  (rating) => html`<button
                    type="button"
                    class="rating-btn"
                    data-rating="${rating}"
                    aria-label="${RATING_LABELS[rating]}${previews
                      ? `, next in ${formatInterval(previews[rating])}`
                      : ""}"
                  >
                    <span class="rating-label">${RATING_LABELS[rating]}</span>
                    ${previews
                      ? html`<span class="rating-interval">${formatInterval(previews[rating])}</span>`
                      : ""}
                  </button>`
                )}
              </div>`
            : html`<button type="button" class="btn btn-default btn-lg btn-block" data-show>
                Show answer
              </button>`}
        </div>
      </div>`
    );

    // The revealed answer is announced, so the card is usable without sight.
    if (revealed) outlet.querySelector(".review-back")?.setAttribute("aria-live", "polite");
  }

  function paintDone(now) {
    const tally = store.todayTally(deck.id, now);
    const upcoming = store
      .cardsOfDeck(deck.id)
      .filter((c) => !c.suspended && c.state !== STATE_NEW)
      .sort((a, b) => a.due - b.due)[0];

    mount(
      outlet,
      html`<div class="review-done">
        <span class="empty-icon" aria-hidden="true">✅</span>
        <h2>Done for today</h2>
        <p class="muted">
          ${tally.new + tally.reviews} answered — ${tally.new} new, ${tally.reviews} reviews.
        </p>
        ${upcoming
          ? html`<p class="muted text-sm">
              Next card due ${new Date(upcoming.due).toLocaleString([], {
                dateStyle: "medium",
                timeStyle: "short",
              })}.
            </p>`
          : ""}
        <button type="button" class="btn btn-default" data-back-to-deck>Back to deck</button>
      </div>`
    );

    // A learning card may become due again in a minute or two; when it does,
    // slip back into the session rather than making the user tap Study again.
    const soonest = store
      .cardsOfDeck(deck.id)
      .filter((c) => !c.suspended && c.state !== STATE_NEW && c.due > now)
      .sort((a, b) => a.due - b.due)[0];
    if (soonest && soonest.due - now < 20 * 60_000) {
      timer = setTimeout(paint, Math.max(1000, soonest.due - now));
    }
  }

  async function answer(rating) {
    if (!current || busy) return;
    busy = true;
    try {
      await store.answer(current.id, rating);
      revealed = false;
      paint();
    } catch (error) {
      toastError(error);
    } finally {
      busy = false;
    }
  }

  async function undo() {
    if (!store.canUndo()) {
      toast("Nothing to undo.");
      return;
    }
    const card = await store.undoLastAnswer();
    if (card) {
      revealed = false;
      paint();
      toast("Answer undone.");
    }
  }

  function onKey(event) {
    if (event.target.matches("input, textarea")) return;
    if (!revealed && (event.key === " " || event.key === "Enter")) {
      event.preventDefault();
      revealed = true;
      paint();
      return;
    }
    if (revealed) {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        answer(GOOD);
      } else if (["1", "2", "3", "4"].includes(event.key)) {
        answer(Number(event.key));
      }
    }
    if (event.key === "u") undo();
  }

  paint();
  document.addEventListener("keydown", onKey);

  const teardowns = [
    on(outlet, "click", "[data-show]", () => {
      revealed = true;
      paint();
    }),
    on(outlet, "click", "[data-stage]", () => {
      if (!revealed) {
        revealed = true;
        paint();
      }
    }),
    on(outlet, "click", "[data-rating]", (_event, element) =>
      answer(Number(element.dataset.rating))
    ),
    on(outlet, "click", "[data-back-to-deck]", () => navigate(`/deck/${deck.id}`)),
  ];

  return () => {
    clearTimeout(timer);
    document.removeEventListener("keydown", onKey);
    teardowns.forEach((fn) => fn());
    setFlush(false);
  };
}
