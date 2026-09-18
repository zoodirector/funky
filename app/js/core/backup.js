/**
 * Exporting the private scheduling state that a deck file deliberately leaves
 * out (see codec.js): stability, difficulty, due dates, review history. This
 * is a backup for this device, not something meant to hand to another
 * person — reimporting it only makes sense on a device that already has the
 * matching notes.
 */

import { canShareFiles, downloadFile, pickFile } from "./share.js";
import { PayloadError } from "./codec.js";
import {
  STATE_LEARNING,
  STATE_NEW,
  STATE_RELEARNING,
  STATE_REVIEW,
} from "./model.js";

export const FORMAT = "funky.learning-state";
export const VERSION = 1;

const MIME = "application/json";
const CARD_STATES = new Set([STATE_NEW, STATE_LEARNING, STATE_REVIEW, STATE_RELEARNING]);

export function buildLearningStatePayload({ cards, reviewLog, counters }, now = Date.now()) {
  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: now,
    cards,
    reviewLog,
    counters,
  };
}

export function serialiseLearningState(snapshot, now = Date.now()) {
  return JSON.stringify(buildLearningStatePayload(snapshot, now), null, 2);
}

function learningStateFilename(now = Date.now()) {
  const date = new Date(now).toISOString().slice(0, 10);
  return `funky-learning-state-${date}.json`;
}

export function learningStateFile(snapshot, now = Date.now()) {
  const text = serialiseLearningState(snapshot, now);
  return new File([text], learningStateFilename(now), { type: MIME });
}

/**
 * Get the current learning state out of the device: shared where files can
 * be, downloaded otherwise. Mirrors `shareDeck` in share.js.
 *
 * @returns {Promise<"shared"|"downloaded"|"cancelled">}
 */
export async function exportLearningState(snapshot, now = Date.now()) {
  const file = learningStateFile(snapshot, now);

  if (canShareFiles(file)) {
    try {
      await navigator.share({ files: [file] });
      return "shared";
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
      downloadFile(file);
      return "downloaded";
    }
  }

  downloadFile(file);
  return "downloaded";
}

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v, fallback = null) => (typeof v === "string" ? v : fallback);
const num = (v, fallback = null) => (Number.isFinite(v) ? v : fallback);
const bool = (v) => v === true;

/** A scheduling snapshot for one card, or null for a row too broken to use. */
function sanitiseCard(entry) {
  if (!isObject(entry) || !str(entry.id) || !str(entry.noteId) || !str(entry.direction)) {
    return null;
  }
  const state = CARD_STATES.has(entry.state) ? entry.state : STATE_NEW;
  return {
    id: entry.id,
    noteId: entry.noteId,
    direction: entry.direction,
    state,
    step: num(entry.step, 0),
    due: num(entry.due, Date.now()),
    stability: num(entry.stability, null),
    difficulty: num(entry.difficulty, null),
    lastReview: num(entry.lastReview, null),
    reps: num(entry.reps, 0),
    lapses: num(entry.lapses, 0),
    suspended: bool(entry.suspended),
  };
}

/** A review log row, or null for a row too broken to use. */
function sanitiseLogEntry(entry) {
  if (!isObject(entry) || !str(entry.cardId) || !num(entry.reviewedAt)) return null;
  const prev = isObject(entry.prev) ? entry.prev : {};
  return {
    cardId: entry.cardId,
    deckId: str(entry.deckId, ""),
    rating: num(entry.rating, 3),
    reviewedAt: entry.reviewedAt,
    elapsedDays: num(entry.elapsedDays, 0),
    stability: num(entry.stability, null),
    difficulty: num(entry.difficulty, null),
    wasNew: bool(entry.wasNew),
    prev: {
      state: CARD_STATES.has(prev.state) ? prev.state : STATE_NEW,
      step: num(prev.step, 0),
      due: num(prev.due, entry.reviewedAt),
      stability: num(prev.stability, null),
      difficulty: num(prev.difficulty, null),
      lastReview: num(prev.lastReview, null),
      reps: num(prev.reps, 0),
      lapses: num(prev.lapses, 0),
      suspended: bool(prev.suspended),
    },
  };
}

/** A day's per-deck counts, or null for a row too broken to use. */
function sanitiseCounterDay(entry) {
  if (!isObject(entry)) return null;
  const day = {};
  for (const [deckId, counts] of Object.entries(entry)) {
    if (!isObject(counts)) continue;
    day[deckId] = { new: num(counts.new, 0), reviews: num(counts.reviews, 0) };
  }
  return day;
}

/**
 * Parse and validate an exported learning-state file. Throws PayloadError
 * with a message fit for a toast, same as a bad deck file.
 */
export function parseLearningStatePayload(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PayloadError("That file is not valid JSON.");
  }

  if (!isObject(raw)) throw new PayloadError("That file is not a Funky learning-state backup.");
  if (raw.format !== FORMAT) {
    throw new PayloadError("That file is not a Funky learning-state backup.");
  }
  if (!Number.isInteger(raw.version) || raw.version < 1) {
    throw new PayloadError("That backup has no usable version number.");
  }
  if (raw.version > VERSION) {
    throw new PayloadError(
      `That backup was made with a newer version of Funky (format ${raw.version}). Update the app first.`
    );
  }

  const cards = Array.isArray(raw.cards) ? raw.cards.map(sanitiseCard).filter(Boolean) : [];
  const reviewLog = Array.isArray(raw.reviewLog)
    ? raw.reviewLog.map(sanitiseLogEntry).filter(Boolean)
    : [];
  const counters = {};
  if (isObject(raw.counters)) {
    for (const [day, entry] of Object.entries(raw.counters)) {
      const sanitised = sanitiseCounterDay(entry);
      if (sanitised) counters[day] = sanitised;
    }
  }

  return { cards, reviewLog, counters };
}

/** Read and validate a File chosen by the user. Throws PayloadError. */
export async function readLearningStateFile(file) {
  const text = await file.text();
  return parseLearningStatePayload(text);
}

/** Open a file picker and return the parsed backup, or null if cancelled. */
export async function pickLearningStateFile() {
  const file = await pickFile();
  return file ? readLearningStateFile(file) : null;
}
