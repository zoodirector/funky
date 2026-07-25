/**
 * Application state: an in-memory mirror of the database, plus the mutations
 * that keep the two in step.
 *
 * Views never touch IndexedDB. They read from here, call a mutation, and
 * re-render when `subscribe` fires. Decks are small enough (thousands of notes
 * at most) that holding everything in memory keeps every read synchronous,
 * which in turn keeps the review loop free of await-induced flicker.
 */

import * as db from "./db.js";
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_DECK_SETTINGS,
  SCHEMA_VERSION,
  STATE_NEW,
  createDeck,
  createNote,
  isBlankNote,
  normaliseTags,
  reconcileCards,
} from "./model.js";
import { answerCard, revertCard } from "./scheduler.js";
import { recordAnswer, tallyFor } from "./queue.js";
import { applyPlan } from "./merge.js";

const state = {
  ready: false,
  decks: new Map(),
  notes: new Map(),
  cards: new Map(),
  settings: { ...DEFAULT_APP_SETTINGS },
  counters: {},
};

const listeners = new Set();
/** Session-scoped undo stack. Deliberately not persisted: undoing a review from
 *  three days ago is never what someone means by "undo". */
const undoStack = [];
const UNDO_LIMIT = 30;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(state);
}

export function getState() {
  return state;
}

export async function init() {
  const [decks, notes, cards, settings, counters] = await Promise.all([
    db.getAll(db.STORE_DECKS),
    db.getAll(db.STORE_NOTES),
    db.getAll(db.STORE_CARDS),
    db.getMeta("settings", null),
    db.getMeta("counters", {}),
  ]);

  state.decks = new Map(decks.map((d) => [d.id, d]));
  state.notes = new Map(notes.map((n) => [n.id, n]));
  state.cards = new Map(cards.map((c) => [c.id, c]));
  state.settings = { ...DEFAULT_APP_SETTINGS, ...(settings ?? {}) };
  state.counters = counters ?? {};
  state.ready = true;

  await db.setMeta("schemaVersion", SCHEMA_VERSION);
  emit();
  return state;
}

/* ---------------------------------------------------------------- reading */

export const listDecks = () =>
  [...state.decks.values()]
    .filter((d) => !d.deleted)
    .sort((a, b) => a.name.localeCompare(b.name));

export const getDeck = (id) => state.decks.get(id) ?? null;

export const notesOfDeck = (deckId, { includeDeleted = false } = {}) =>
  [...state.notes.values()]
    .filter((n) => n.deckId === deckId && (includeDeleted || !n.deleted))
    .sort((a, b) => b.created - a.created);

export const getNote = (id) => state.notes.get(id) ?? null;

export const cardsOfDeck = (deckId) =>
  [...state.cards.values()].filter((c) => c.deckId === deckId);

export const cardsOfNote = (noteId) =>
  [...state.cards.values()].filter((c) => c.noteId === noteId);

export const getCard = (id) => state.cards.get(id) ?? null;

export const deckSettings = (deckId) => ({
  ...DEFAULT_DECK_SETTINGS,
  ...(state.decks.get(deckId)?.settings ?? {}),
  dayCutoffHour: state.settings.dayCutoffHour,
});

export const todayTally = (deckId, now = Date.now()) =>
  tallyFor(state.counters, deckId, now, state.settings.dayCutoffHour);

export const tagsOfDeck = (deckId) => {
  const tags = new Set();
  for (const note of notesOfDeck(deckId)) for (const tag of note.tags) tags.add(tag);
  return [...tags].sort();
};

export const canUndo = () => undoStack.length > 0;

/* --------------------------------------------------------------- settings */

export async function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await db.setMeta("settings", state.settings);
  emit();
  return state.settings;
}

/* ------------------------------------------------------------------ decks */

export async function addDeck({ name, frontLang, backLang }) {
  const deck = createDeck({ name, frontLang, backLang });
  state.decks.set(deck.id, deck);
  await db.put(db.STORE_DECKS, deck);
  emit();
  return deck;
}

export async function updateDeck(deckId, patch) {
  const deck = state.decks.get(deckId);
  if (!deck) return null;
  const next = { ...deck, ...patch, modified: Date.now() };
  if (patch.settings) next.settings = { ...deck.settings, ...patch.settings };
  state.decks.set(deckId, next);
  await db.put(db.STORE_DECKS, next);
  emit();
  return next;
}

/**
 * Delete a deck and everything under it. This is a local, permanent delete —
 * unlike a note deletion it does not propagate, because there is no sensible
 * way for "I removed this deck" to mean anything to a collaborator.
 */
export async function deleteDeck(deckId) {
  const noteIds = [...state.notes.values()].filter((n) => n.deckId === deckId).map((n) => n.id);
  const cardIds = cardsOfDeck(deckId).map((c) => c.id);

  for (const id of noteIds) state.notes.delete(id);
  for (const id of cardIds) state.cards.delete(id);
  state.decks.delete(deckId);

  await Promise.all([
    db.remove(db.STORE_DECKS, deckId),
    db.removeAll(db.STORE_NOTES, noteIds),
    db.removeAll(db.STORE_CARDS, cardIds),
  ]);
  emit();
}

/* ------------------------------------------------------------------ notes */

/**
 * Create or update a note and bring its cards in line with its `directions`.
 * Existing cards are never rebuilt, so editing a typo does not cost you the
 * scheduling history of that card.
 */
export async function saveNote(input) {
  const now = Date.now();
  const existing = input.id ? state.notes.get(input.id) : null;

  const note = existing
    ? {
        ...existing,
        term: (input.term ?? existing.term).trim(),
        translation: (input.translation ?? existing.translation).trim(),
        example: (input.example ?? existing.example).trim(),
        note: (input.note ?? existing.note).trim(),
        tags: normaliseTags(input.tags ?? existing.tags),
        directions: input.directions ?? existing.directions,
        modified: now,
      }
    : createNote({ ...input, now });

  if (isBlankNote(note)) throw new Error("A note needs at least a term or a translation.");

  const { create, remove } = reconcileCards(note, cardsOfNote(note.id), now);

  state.notes.set(note.id, note);
  for (const card of create) state.cards.set(card.id, card);
  for (const id of remove) state.cards.delete(id);

  await Promise.all([
    db.put(db.STORE_NOTES, note),
    create.length ? db.putAll(db.STORE_CARDS, create) : null,
    remove.length ? db.removeAll(db.STORE_CARDS, remove) : null,
  ]);
  emit();
  return note;
}

/**
 * Soft-delete a note. The tombstone stays so the deletion travels with the
 * next export; the cards go, since they are local anyway.
 */
export async function deleteNote(noteId) {
  const note = state.notes.get(noteId);
  if (!note) return;
  const next = { ...note, deleted: true, modified: Date.now() };
  const cardIds = cardsOfNote(noteId).map((c) => c.id);

  state.notes.set(noteId, next);
  for (const id of cardIds) state.cards.delete(id);

  await Promise.all([db.put(db.STORE_NOTES, next), db.removeAll(db.STORE_CARDS, cardIds)]);
  emit();
}

/* ---------------------------------------------------------------- reviews */

/** Answer a card: schedule it, log it, count it. */
export async function answer(cardId, rating, now = Date.now()) {
  const card = state.cards.get(cardId);
  if (!card) throw new Error(`No such card: ${cardId}`);

  const wasNew = card.state === STATE_NEW;
  const settings = deckSettings(card.deckId);
  const { card: next, log } = answerCard(card, rating, now, settings);

  state.cards.set(next.id, next);
  state.counters = recordAnswer(
    state.counters,
    card.deckId,
    wasNew,
    now,
    state.settings.dayCutoffHour
  );

  const logId = await db.tx(db.STORE_REVLOG, "readwrite", (store) =>
    new Promise((resolve, reject) => {
      const request = store.add({ ...log, wasNew });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    })
  );

  undoStack.push({ ...log, id: logId, wasNew });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();

  await Promise.all([
    db.put(db.STORE_CARDS, next),
    db.setMeta("counters", state.counters),
  ]);
  emit();
  return next;
}

/** Undo the most recent answer of this session. */
export async function undoLastAnswer() {
  const log = undoStack.pop();
  if (!log) return null;

  const card = state.cards.get(log.cardId);
  if (!card) return null;

  const reverted = revertCard(card, log);
  state.cards.set(reverted.id, reverted);

  // Roll the daily tally back by one in the same bucket it was added to.
  const day = Object.keys(state.counters)
    .map(Number)
    .sort((a, b) => b - a)
    .find((d) => state.counters[d]?.[log.deckId]);
  if (day !== undefined) {
    const entry = state.counters[day][log.deckId];
    state.counters = {
      ...state.counters,
      [day]: {
        ...state.counters[day],
        [log.deckId]: {
          new: Math.max(0, entry.new - (log.wasNew ? 1 : 0)),
          reviews: Math.max(0, entry.reviews - (log.wasNew ? 0 : 1)),
        },
      },
    };
  }

  await Promise.all([
    db.put(db.STORE_CARDS, reverted),
    db.remove(db.STORE_REVLOG, log.id),
    db.setMeta("counters", state.counters),
  ]);
  emit();
  return reverted;
}

export const reviewLog = () => db.getAll(db.STORE_REVLOG);

/* ------------------------------------------------------------------ merge */

/**
 * Apply a merge plan produced by merge.js. Creates the deck when importing as
 * new, writes the resulting notes, and materialises cards for anything that
 * does not have them yet — always in the `new` state, because a friend's
 * scheduling is not yours.
 */
export async function applyMerge({ plan, deck, createDeckFrom = null }) {
  const now = Date.now();
  let targetDeck = deck;

  if (!targetDeck && createDeckFrom) {
    targetDeck = createDeck({
      id: createDeckFrom.id,
      name: createDeckFrom.name,
      frontLang: createDeckFrom.frontLang,
      backLang: createDeckFrom.backLang,
      now,
    });
    state.decks.set(targetDeck.id, targetDeck);
    await db.put(db.STORE_DECKS, targetDeck);
  }
  if (!targetDeck) throw new Error("No target deck for the merge.");

  const touched = applyPlan([], { add: plan.add, update: plan.update }).map((n) => ({
    ...n,
    deckId: targetDeck.id,
  }));

  const newCards = [];
  const staleCardIds = [];

  for (const note of touched) {
    state.notes.set(note.id, note);
    const { create, remove } = reconcileCards(note, cardsOfNote(note.id), now);
    for (const card of create) {
      state.cards.set(card.id, card);
      newCards.push(card);
    }
    for (const id of remove) {
      state.cards.delete(id);
      staleCardIds.push(id);
    }
  }

  await Promise.all([
    db.putAll(db.STORE_NOTES, touched),
    newCards.length ? db.putAll(db.STORE_CARDS, newCards) : null,
    staleCardIds.length ? db.removeAll(db.STORE_CARDS, staleCardIds) : null,
  ]);
  emit();

  return { deck: targetDeck, notes: touched.length, cards: newCards.length };
}

/* ------------------------------------------------------------------ reset */

export async function resetEverything() {
  await db.clearAll();
  state.decks.clear();
  state.notes.clear();
  state.cards.clear();
  state.counters = {};
  state.settings = { ...DEFAULT_APP_SETTINGS };
  undoStack.length = 0;
  emit();
}
