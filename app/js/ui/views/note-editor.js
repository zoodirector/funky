/** Create or edit a note. */

import { formValues, html, mount, on } from "../dom.js";
import { navigate } from "../router.js";
import { setFlush, setHeader } from "../shell.js";
import { confirmDialog } from "../components/dialog.js";
import { toast, toastError } from "../components/toast.js";
import * as store from "../../core/store.js";
import {
  DIRECTIONS_BOTH,
  DIRECTIONS_FORWARD,
  DIRECTIONS_REVERSE,
  STATE_NEW,
} from "../../core/model.js";

const DIRECTION_CHOICES = [
  { value: DIRECTIONS_BOTH, label: "Both ways (2 cards)" },
  { value: DIRECTIONS_FORWARD, label: "Term → translation only" },
  { value: DIRECTIONS_REVERSE, label: "Translation → term only" },
];

export function render({ params, outlet }) {
  const deck = store.getDeck(params.id);
  if (!deck) {
    navigate("/decks", { replace: true });
    return;
  }

  const isNew = params.noteId === "new";
  const note = isNew ? null : store.getNote(params.noteId);
  if (!isNew && !note) {
    navigate(`/deck/${deck.id}`, { replace: true });
    return;
  }

  const cards = note ? store.cardsOfNote(note.id) : [];
  const backPath = `/deck/${deck.id}`;

  setFlush(false);
  setHeader({
    title: isNew ? "New note" : "Edit note",
    back: backPath,
    tabs: false,
  });

  mount(
    outlet,
    html`<form class="stack" data-form novalidate>
      <div>
        <label class="label" for="f-term">${deck.frontLang || "Term"}</label>
        <input
          class="input"
          id="f-term"
          name="term"
          value="${note?.term ?? ""}"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          enterkeyhint="next"
        />
      </div>

      <div>
        <label class="label" for="f-translation">${deck.backLang || "Translation"}</label>
        <input
          class="input"
          id="f-translation"
          name="translation"
          value="${note?.translation ?? ""}"
          autocomplete="off"
          enterkeyhint="next"
        />
      </div>

      <div>
        <label class="label" for="f-example">Example sentence <span class="muted">(optional)</span></label>
        <textarea class="textarea" id="f-example" name="example" rows="2">${note?.example ?? ""}</textarea>
      </div>

      <div>
        <label class="label" for="f-note">Note <span class="muted">(optional)</span></label>
        <input class="input" id="f-note" name="note" value="${note?.note ?? ""}" placeholder="e.g. feminine" />
      </div>

      <div>
        <label class="label" for="f-tags">Tags <span class="muted">(optional)</span></label>
        <input
          class="input"
          id="f-tags"
          name="tags"
          value="${note?.tags.join(" ") ?? ""}"
          placeholder="nouns food"
          autocapitalize="none"
        />
        <p class="field-hint">Separated by spaces or commas.</p>
      </div>

      <div>
        <label class="label" for="f-directions">Ask me</label>
        <select class="select" id="f-directions" name="directions">
          ${DIRECTION_CHOICES.map(
            (choice) => html`<option
              value="${choice.value}"
              ${(note?.directions ?? DIRECTIONS_BOTH) === choice.value ? "selected" : ""}
            >
              ${choice.label}
            </option>`
          )}
        </select>
        ${cards.length
          ? html`<p class="field-hint">
              ${cards
                .map((card) => `${card.direction === "fwd" ? "→" : "←"} ${cardStatus(card)}`)
                .join(" · ")}
            </p>`
          : ""}
      </div>

      <button type="submit" class="btn btn-default btn-block">Save</button>

      ${isNew
        ? ""
        : html`<button type="button" class="btn btn-ghost btn-block" data-delete>Delete note</button>`}
    </form>`
  );

  outlet.querySelector("#f-term").focus();

  const teardowns = [
    on(outlet, "submit", "[data-form]", async (event) => {
      event.preventDefault();
      const values = formValues(event.target);
      try {
        await store.saveNote({
          id: note?.id,
          deckId: deck.id,
          term: values.term,
          translation: values.translation,
          example: values.example,
          note: values.note,
          tags: values.tags,
          directions: values.directions,
        });

        if (isNew) {
          // Adding cards is a streak activity: clear the form and stay put.
          event.target.reset();
          outlet.querySelector("#f-term").focus();
          toast("Note added.");
        } else {
          toast("Note saved.");
          navigate(backPath);
        }
      } catch (error) {
        toastError(error);
      }
    }),

    on(outlet, "click", "[data-delete]", async () => {
      const confirmed = await confirmDialog({
        title: "Delete this note?",
        description:
          "It is removed from this deck and from anyone you share the deck with next. Your progress on its cards is lost.",
        confirmLabel: "Delete",
        destructive: true,
      });
      if (!confirmed) return;
      await store.deleteNote(note.id);
      toast("Note deleted.");
      navigate(backPath);
    }),
  ];

  return () => teardowns.forEach((fn) => fn());
}

function cardStatus(card) {
  if (card.state === STATE_NEW) return "new";
  if (card.suspended) return "suspended";
  const due = new Date(card.due);
  return `due ${due.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}
