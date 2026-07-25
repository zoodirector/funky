/**
 * Merging a friend's deck into your own.
 *
 * The rules are chosen so that merging is **commutative and idempotent**:
 * A⊕B and B⊕A produce the same note set, and importing the same file twice
 * changes nothing the second time. That is what makes the intended workflow —
 * everyone exports, everyone imports, repeat — actually converge instead of
 * slowly diverging. In CRDT terms this is a state-based register set with
 * last-write-wins per note and tombstones for deletion.
 *
 * Two invariants hold no matter what arrives:
 *   1. Only note *content* is ever written. Cards, stability, due dates and
 *      review history are local and untouched.
 *   2. Nothing is applied until the user has seen the report and confirmed.
 */

import { NOTE_CONTENT_FIELDS, dedupeKey } from "./model.js";

export const ADD_AS_NEW_DECK = "new-deck";
export const MERGE_INTO_DECK = "merge";

/** Stable serialisation of the fields that a merge compares. */
function canonical(note) {
  return JSON.stringify(
    NOTE_CONTENT_FIELDS.map((f) => (f === "tags" ? [...(note.tags ?? [])].sort() : note[f] ?? "")).concat(
      note.deleted ? 1 : 0
    )
  );
}

const sameContent = (a, b) => canonical(a) === canonical(b);

/**
 * Which of two versions of the same note wins.
 *
 * Newer `modified` wins. On an exact tie with differing content — two people
 * editing within the same millisecond, or clocks that disagree — we compare
 * the canonical form and take the lexicographically greater one. It is
 * arbitrary, but it is arbitrary *in the same way on both devices*, which is
 * the property that matters: no tie can leave the two copies disagreeing.
 */
function winner(local, incoming) {
  if (incoming.modified > local.modified) return incoming;
  if (incoming.modified < local.modified) return local;
  return canonical(incoming) > canonical(local) ? incoming : local;
}

/** Copy content fields from `source` onto `target`, leaving local ids alone. */
function applyContent(target, source) {
  const next = { ...target };
  for (const field of NOTE_CONTENT_FIELDS) next[field] = source[field];
  next.deleted = source.deleted === true;
  next.modified = source.modified;
  // `created` is the earliest known creation, so re-importing cannot push it later.
  next.created = Math.min(target.created ?? source.created, source.created ?? target.created);
  return next;
}

/**
 * Work out what an import would do, without doing it.
 *
 * @param {object[]} localNotes notes already in the target deck
 * @param {object}   payload    parsed export payload
 * @param {object}   options
 * @param {string}   options.targetDeckId deck the notes will belong to
 * @param {Record<string,string>} options.duplicateMap incoming id → local id,
 *        for near-duplicates the user chose to fuse
 * @returns {{report: object, add: object[], update: object[]}}
 */
export function planMerge(localNotes, payload, { targetDeckId, duplicateMap = {} } = {}) {
  const deckId = targetDeckId ?? payload.deck.id;
  const byId = new Map(localNotes.map((n) => [n.id, n]));
  const byKey = new Map();
  for (const note of localNotes) {
    if (!note.deleted) byKey.set(dedupeKey(note), note);
  }

  const add = [];
  const update = [];
  const duplicates = [];
  let unchanged = 0;
  let deleted = 0;

  for (const incoming of payload.notes) {
    const mappedId = duplicateMap[incoming.id];
    const local = byId.get(incoming.id) ?? (mappedId ? byId.get(mappedId) : undefined);

    if (!local) {
      // Not known by id — but it may still be the same card written twice by
      // two people. Flag it; the user decides whether to fuse or keep both.
      const twin = byKey.get(dedupeKey(incoming));
      if (twin && !incoming.deleted) {
        duplicates.push({ incoming, local: twin });
      }
      if (incoming.deleted) {
        // A tombstone for a note we never had: nothing to do, but recording it
        // keeps the note from being re-added by a later import.
        add.push({ ...incoming, deckId });
        deleted += 1;
      } else {
        add.push({ ...incoming, deckId });
      }
      continue;
    }

    const chosen = winner(local, incoming);
    if (chosen === local || sameContent(local, incoming)) {
      unchanged += 1;
      continue;
    }
    update.push(applyContent(local, incoming));
    if (incoming.deleted && !local.deleted) deleted += 1;
  }

  const report = {
    deckName: payload.deck.name,
    noteCount: payload.notes.length,
    added: add.filter((n) => !n.deleted).length,
    updated: update.filter((n) => !n.deleted).length,
    deleted,
    unchanged,
    duplicates,
    exportedAt: payload.exportedAt ?? null,
  };

  return { report, add, update };
}

/**
 * Apply a plan to a note array. Pure — used by the store to compute the next
 * state, and by the tests to check convergence properties directly.
 */
export function applyPlan(localNotes, plan) {
  const byId = new Map(localNotes.map((n) => [n.id, n]));
  for (const note of plan.add) byId.set(note.id, note);
  for (const note of plan.update) byId.set(note.id, note);
  return [...byId.values()];
}

/** Convenience for tests and one-shot merges. */
export function mergeNotes(localNotes, payload, options) {
  return applyPlan(localNotes, planMerge(localNotes, payload, options));
}

/**
 * Decide how an incoming deck relates to the local ones. Same id means the two
 * are the same deck and merge in place; otherwise the user picks.
 */
export function suggestDeckAction(localDecks, payload) {
  const sameId = localDecks.find((d) => d.id === payload.deck.id && !d.deleted);
  if (sameId) return { action: MERGE_INTO_DECK, deck: sameId, forced: true };

  const sameName = localDecks.find(
    (d) => !d.deleted && d.name.trim().toLowerCase() === payload.deck.name.trim().toLowerCase()
  );
  return sameName
    ? { action: MERGE_INTO_DECK, deck: sameName, forced: false }
    : { action: ADD_AS_NEW_DECK, deck: null, forced: false };
}
