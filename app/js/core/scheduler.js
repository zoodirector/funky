/**
 * The card state machine: the classic learning/review/relearning steps wrapped
 * around the FSRS memory model.
 *
 * FSRS alone answers "when should this be seen again in days?", which is not
 * useful for a card you have just met and failed twice in a row. The usual
 * answer — and ours — is short learning steps measured in minutes, with FSRS
 * taking over once the card graduates. Memory state (S, D) is still updated on every
 * single answer, using the short-term formula for same-day repeats.
 *
 * `answerCard` is pure: it takes a card and returns a new one. Persisting the
 * result is the store's job.
 */

import {
  AGAIN,
  EASY,
  GOOD,
  HARD,
  applyFuzz,
  clamp,
  initialDifficulty,
  initialStability,
  intervalDays,
  nextDifficulty,
  nextStability,
  retrievability,
  shortTermStability,
  DEFAULT_W,
} from "./fsrs.js";
import {
  DAY,
  DEFAULT_DECK_SETTINGS,
  MINUTE,
  STATE_LEARNING,
  STATE_NEW,
  STATE_RELEARNING,
  STATE_REVIEW,
} from "./model.js";

/** Elapsed days since the previous review, 0 for a card never reviewed. */
export function elapsedDaysOf(card, now) {
  if (!card.lastReview) return 0;
  return Math.max(0, (now - card.lastReview) / DAY);
}

/**
 * Update (stability, difficulty) for one answer. Three cases: the first ever
 * review seeds the memory state, a same-day repeat uses the short-term
 * formula, and a genuine later review uses the long-term formulas.
 */
function updateMemory(card, rating, now, w) {
  if (card.stability == null || card.difficulty == null) {
    return {
      stability: initialStability(rating, w),
      difficulty: initialDifficulty(rating, w),
    };
  }

  const elapsed = elapsedDaysOf(card, now);
  const difficulty = nextDifficulty(card.difficulty, rating, w);
  const stability =
    elapsed < 1
      ? shortTermStability(card.stability, rating, w)
      : nextStability(
          card.difficulty,
          card.stability,
          retrievability(elapsed, card.stability),
          rating,
          w
        );

  return { stability, difficulty };
}

/**
 * The Hard delay inside a step queue: halfway to the next step if there is
 * one, otherwise 1.5× the current step. It keeps Hard from being either a
 * no-op or a promotion.
 */
function hardDelayMinutes(steps, step) {
  const current = steps[step] ?? steps.at(-1) ?? 10;
  const next = steps[step + 1];
  return next === undefined ? current * 1.5 : (current + next) / 2;
}

/** Days until a graduated card should be seen again, fuzzed and clamped. */
function reviewIntervalDays(stability, settings, rand) {
  const raw = intervalDays(stability, settings.desiredRetention);
  const fuzzed = applyFuzz(raw, rand);
  return clamp(Math.round(fuzzed), 1, settings.maximumInterval);
}

/**
 * Answer a card. Returns the next card state plus a log entry that carries
 * enough of the previous state to undo the answer.
 *
 * @param {object} card
 * @param {1|2|3|4} rating
 * @param {number} now epoch ms
 * @param {object} settings deck settings
 * @param {() => number} rand injected for deterministic tests
 */
export function answerCard(card, rating, now = Date.now(), settings = DEFAULT_DECK_SETTINGS, rand = Math.random) {
  const cfg = { ...DEFAULT_DECK_SETTINGS, ...settings };
  const w = cfg.w ?? DEFAULT_W;
  const learningSteps = cfg.learningSteps.length ? cfg.learningSteps : [1, 10];
  const relearningSteps = cfg.relearningSteps;

  const { stability, difficulty } = updateMemory(card, rating, now, w);
  const next = {
    ...card,
    stability,
    difficulty,
    lastReview: now,
    reps: card.reps + 1,
  };

  const graduate = () => {
    next.state = STATE_REVIEW;
    next.step = 0;
    next.due = now + reviewIntervalDays(stability, cfg, rand) * DAY;
  };

  const isLearning = card.state === STATE_NEW || card.state === STATE_LEARNING;
  const isRelearning = card.state === STATE_RELEARNING;

  if (isLearning || isRelearning) {
    const steps = isRelearning ? relearningSteps : learningSteps;
    const stepState = isRelearning ? STATE_RELEARNING : STATE_LEARNING;

    // A relearning deck with no steps configured goes straight back to review.
    if (!steps.length) {
      graduate();
    } else if (rating === AGAIN) {
      next.state = stepState;
      next.step = 0;
      next.due = now + steps[0] * MINUTE;
    } else if (rating === HARD) {
      next.state = stepState;
      next.step = card.step;
      next.due = now + hardDelayMinutes(steps, card.step) * MINUTE;
    } else if (rating === EASY) {
      graduate();
    } else {
      const step = card.step + 1;
      if (step >= steps.length) {
        graduate();
      } else {
        next.state = stepState;
        next.step = step;
        next.due = now + steps[step] * MINUTE;
      }
    }
  } else if (rating === AGAIN) {
    next.lapses = card.lapses + 1;
    if (relearningSteps.length) {
      next.state = STATE_RELEARNING;
      next.step = 0;
      next.due = now + relearningSteps[0] * MINUTE;
    } else {
      graduate();
    }
    if (next.lapses >= cfg.leechThreshold) next.suspended = true;
  } else {
    graduate();
  }

  const log = {
    cardId: card.id,
    deckId: card.deckId,
    rating,
    reviewedAt: now,
    elapsedDays: elapsedDaysOf(card, now),
    stability,
    difficulty,
    // Everything needed to put the card back exactly as it was.
    prev: {
      state: card.state,
      step: card.step,
      due: card.due,
      stability: card.stability,
      difficulty: card.difficulty,
      lastReview: card.lastReview,
      reps: card.reps,
      lapses: card.lapses,
      suspended: card.suspended,
    },
  };

  return { card: next, log };
}

/** Restore a card from a log entry's snapshot. Used by undo. */
export function revertCard(card, log) {
  return { ...card, ...log.prev };
}

/**
 * What each of the four buttons would do, for the interval preview shown on
 * the answer buttons. Fuzz is pinned to its midpoint so the numbers on the
 * buttons match what actually happens closely enough to be honest.
 */
export function previewIntervals(card, now = Date.now(), settings = DEFAULT_DECK_SETTINGS) {
  const midpoint = () => 0.5;
  const out = {};
  for (const rating of [AGAIN, HARD, GOOD, EASY]) {
    const { card: next } = answerCard(card, rating, now, settings, midpoint);
    out[rating] = next.due - now;
  }
  return out;
}

/** Human-readable duration, in a compact style: 10m, 4d, 2.1mo, 1.4y. */
export function formatInterval(ms) {
  const minutes = ms / MINUTE;
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = ms / DAY;
  if (days < 30) return `${Math.round(days)}d`;
  const months = days / 30.44;
  if (months < 12) return `${months < 10 ? months.toFixed(1) : Math.round(months)}mo`;
  const years = days / 365.25;
  return `${years < 10 ? years.toFixed(1) : Math.round(years)}y`;
}

/** Current recall probability, for the stats view. Null before graduation. */
export function currentRetrievability(card, now = Date.now()) {
  if (card.stability == null || !card.lastReview) return null;
  return retrievability(elapsedDaysOf(card, now), card.stability);
}
