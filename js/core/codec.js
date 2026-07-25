/**
 * The deck exchange format.
 *
 * Deliberately plain, pretty-printed JSON: two people co-authoring a deck
 * should be able to open the file, read it, and see what changed. Compression
 * would buy a few kilobytes and cost all of that.
 *
 * Scheduling state is **not** part of the format. Stability, difficulty and due
 * dates describe one person's memory; they are meaningless to the recipient,
 * and shipping them would let an import overwrite real progress.
 */

import { DIRECTIONS_BOTH, SCHEMA_VERSION, normaliseTags } from "./model.js";

export const FORMAT = "funky.deck";

/** Fields of a note that travel; everything else is local. */
function packNote(note) {
  const packed = {
    id: note.id,
    term: note.term,
    translation: note.translation,
    created: note.created,
    modified: note.modified,
  };
  if (note.example) packed.example = note.example;
  if (note.note) packed.note = note.note;
  if (note.tags?.length) packed.tags = note.tags;
  if (note.directions && note.directions !== DIRECTIONS_BOTH) {
    packed.directions = note.directions;
  }
  // Tombstones travel too, or a deletion would be undone by the next import.
  if (note.deleted) packed.deleted = true;
  return packed;
}

export function buildPayload(deck, notes, now = Date.now()) {
  return {
    format: FORMAT,
    version: SCHEMA_VERSION,
    exportedAt: now,
    deck: {
      id: deck.id,
      name: deck.name,
      frontLang: deck.frontLang ?? "",
      backLang: deck.backLang ?? "",
      created: deck.created,
      modified: deck.modified,
    },
    notes: notes.map(packNote),
  };
}

export function serialise(deck, notes, now = Date.now()) {
  return JSON.stringify(buildPayload(deck, notes, now), null, 2);
}

class PayloadError extends Error {
  constructor(message) {
    super(message);
    this.name = "PayloadError";
  }
}

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v, fallback = "") => (typeof v === "string" ? v : fallback);
const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);

/**
 * Parse and validate an exported deck. Throws PayloadError with a message fit
 * for a toast — a friend sending the wrong file should see "this is not a
 * Funky deck", not a stack trace.
 */
export function parsePayload(text, now = Date.now()) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PayloadError("That file is not valid JSON.");
  }

  if (!isObject(raw)) throw new PayloadError("That file is not a Funky deck.");
  if (raw.format !== FORMAT) {
    throw new PayloadError("That file is not a Funky deck.");
  }
  if (!Number.isInteger(raw.version) || raw.version < 1) {
    throw new PayloadError("That deck file has no usable version number.");
  }
  if (raw.version > SCHEMA_VERSION) {
    throw new PayloadError(
      `That deck was made with a newer version of Funky (format ${raw.version}). Update the app first.`
    );
  }
  if (!isObject(raw.deck) || !str(raw.deck.id)) {
    throw new PayloadError("That deck file is missing its deck header.");
  }
  if (!Array.isArray(raw.notes)) {
    throw new PayloadError("That deck file contains no notes list.");
  }

  const deck = {
    id: raw.deck.id,
    name: str(raw.deck.name, "Imported deck").trim() || "Imported deck",
    frontLang: str(raw.deck.frontLang),
    backLang: str(raw.deck.backLang),
    created: num(raw.deck.created, now),
    modified: num(raw.deck.modified, now),
  };

  const seen = new Set();
  const notes = [];
  for (const entry of raw.notes) {
    if (!isObject(entry) || !str(entry.id)) continue; // skip junk rows, keep the rest
    if (seen.has(entry.id)) continue; // a duplicate id within one file: first wins
    seen.add(entry.id);
    notes.push({
      id: entry.id,
      deckId: deck.id,
      term: str(entry.term).trim(),
      translation: str(entry.translation).trim(),
      example: str(entry.example).trim(),
      note: str(entry.note).trim(),
      tags: normaliseTags(entry.tags ?? []),
      directions: str(entry.directions, DIRECTIONS_BOTH),
      created: num(entry.created, now),
      modified: num(entry.modified, now),
      deleted: entry.deleted === true,
    });
  }

  return { ...raw, deck, notes };
}

export { PayloadError };

/** A filename a messenger will not mangle. */
export function exportFilename(deck, now = Date.now()) {
  const slug =
    deck.name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "deck";
  const date = new Date(now).toISOString().slice(0, 10);
  return `funky-${slug}-${date}.json`;
}
