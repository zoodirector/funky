/**
 * Session queue: which card comes next, and how many are left today.
 *
 * The study day does not start at midnight — a review at 01:00 belongs to the
 * previous study day, otherwise night owls get two days' worth of cards in one
 * sitting. Everything here is expressed in terms of that shifted day index.
 *
 * The queue is not materialised as a list. Answering a card changes when it is
 * next due (a lapsed card can come back within the same session), so we pick
 * the next card from live state each time. Decks are small enough that this is
 * cheaper than keeping a list in sync.
 */

import {
  DAY,
  DEFAULT_DECK_SETTINGS,
  MINUTE,
  STATE_LEARNING,
  STATE_NEW,
  STATE_RELEARNING,
  STATE_REVIEW,
} from "./model.js";

/** How far ahead we may pull a learning card when nothing else is waiting. */
export const LEARN_AHEAD_MS = 20 * MINUTE;

/** Study-day number for a timestamp, given the rollover hour. */
export function dayIndex(now, cutoffHour = 4) {
  const shifted = new Date(now - cutoffHour * 60 * MINUTE);
  return Math.floor(
    Date.UTC(shifted.getFullYear(), shifted.getMonth(), shifted.getDate()) / DAY
  );
}

/** End of the current study day, in epoch ms. */
export function dayEnd(now, cutoffHour = 4) {
  const d = new Date(now);
  const cutoffToday = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    cutoffHour,
    0,
    0,
    0
  ).getTime();
  return now < cutoffToday ? cutoffToday : cutoffToday + DAY;
}

const isLearningState = (card) =>
  card.state === STATE_LEARNING || card.state === STATE_RELEARNING;

/** Cards that count towards this session, i.e. not suspended. */
const active = (cards) => cards.filter((c) => !c.suspended);

/**
 * How many cards of each kind are waiting, after the daily caps.
 * `done` is today's tally for this deck: { new, reviews }.
 */
export function deckCounts(cards, now = Date.now(), settings = DEFAULT_DECK_SETTINGS, done = { new: 0, reviews: 0 }) {
  const cfg = { ...DEFAULT_DECK_SETTINGS, ...settings };
  const end = dayEnd(now, cfg.dayCutoffHour ?? 4);
  const pool = active(cards);

  const learning = pool.filter((c) => isLearningState(c) && c.due <= end).length;
  const dueReviews = pool.filter((c) => c.state === STATE_REVIEW && c.due <= end).length;
  const newCards = pool.filter((c) => c.state === STATE_NEW).length;

  const counts = {
    learning,
    review: Math.max(0, Math.min(dueReviews, cfg.reviewsPerDay - done.reviews)),
    new: Math.max(0, Math.min(newCards, cfg.newPerDay - done.new)),
  };
  return { ...counts, pending: counts.learning + counts.review + counts.new };
}

/**
 * The next card to show, or null when the session is finished.
 *
 * Order of preference: a learning card that is actually due, then reviews and
 * new cards interleaved (roughly one new card per `spacing` reviews, so new
 * material is spread through the session rather than front-loaded), then —
 * only if nothing else remains — a learning card due slightly in the future,
 * which is the usual "learn ahead" behaviour.
 */
export function pickNext(cards, now = Date.now(), settings = DEFAULT_DECK_SETTINGS, done = { new: 0, reviews: 0 }) {
  const cfg = { ...DEFAULT_DECK_SETTINGS, ...settings };
  const cutoffHour = cfg.dayCutoffHour ?? 4;
  const end = dayEnd(now, cutoffHour);
  const pool = active(cards);

  const byDue = (a, b) => a.due - b.due || (a.id < b.id ? -1 : 1);

  const learningDue = pool.filter((c) => isLearningState(c) && c.due <= now).sort(byDue);
  if (learningDue.length) return learningDue[0];

  const reviewsLeft = cfg.reviewsPerDay - done.reviews;
  const newLeft = cfg.newPerDay - done.new;

  const reviewDue =
    reviewsLeft > 0
      ? pool.filter((c) => c.state === STATE_REVIEW && c.due <= end).sort(byDue)
      : [];
  const newDue =
    newLeft > 0 ? pool.filter((c) => c.state === STATE_NEW).sort(byDue) : [];

  if (reviewDue.length && newDue.length) {
    const spacing = Math.max(1, Math.round(reviewDue.length / newDue.length));
    // done.reviews advances as the session runs, so this alternates over time.
    return done.reviews % (spacing + 1) === spacing ? newDue[0] : reviewDue[0];
  }
  if (reviewDue.length) return reviewDue[0];
  if (newDue.length) return newDue[0];

  const learningSoon = pool
    .filter((c) => isLearningState(c) && c.due <= now + LEARN_AHEAD_MS)
    .sort(byDue);
  return learningSoon[0] ?? null;
}

/**
 * Cards due per day for the next `days` days — the stats forecast. Learning
 * cards are folded into day 0 since they are all due within the session.
 */
export function dueForecast(cards, now = Date.now(), days = 14, cutoffHour = 4) {
  const buckets = new Array(days).fill(0);
  const end = dayEnd(now, cutoffHour);
  for (const card of active(cards)) {
    if (card.state === STATE_NEW) continue;
    const offset = card.due <= end ? 0 : Math.ceil((card.due - end) / DAY);
    if (offset >= 0 && offset < days) buckets[offset] += 1;
  }
  return buckets;
}

/** Today's tally for a deck, read out of the persisted counter map. */
export function tallyFor(counters, deckId, now = Date.now(), cutoffHour = 4) {
  const today = counters?.[dayIndex(now, cutoffHour)]?.[deckId];
  return { new: today?.new ?? 0, reviews: today?.reviews ?? 0 };
}

/**
 * Record one answered card in the counter map, returning a new map. Days older
 * than a fortnight are dropped so this cannot grow without bound.
 */
export function recordAnswer(counters, deckId, wasNew, now = Date.now(), cutoffHour = 4) {
  const today = dayIndex(now, cutoffHour);
  const next = {};
  for (const [day, decks] of Object.entries(counters ?? {})) {
    if (today - Number(day) <= 14) next[day] = decks;
  }
  const forDay = { ...(next[today] ?? {}) };
  const prev = forDay[deckId] ?? { new: 0, reviews: 0 };
  forDay[deckId] = {
    new: prev.new + (wasNew ? 1 : 0),
    reviews: prev.reviews + (wasNew ? 0 : 1),
  };
  next[today] = forDay;
  return next;
}
