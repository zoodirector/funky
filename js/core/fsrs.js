/**
 * FSRS-5 — the memory model this app schedules with.
 *
 * Pure maths only: no DOM, no storage, no notion of a "card". The card state
 * machine (learning steps, lapses, day boundaries) lives in scheduler.js.
 *
 * Three variables describe a memory:
 *   S  stability      — days for recall probability to fall from 100% to 90%
 *   D  difficulty     — intrinsic hardness of the item, in [1, 10]
 *   R  retrievability — probability of recall right now, in (0, 1]
 *
 * We use the published default weights and never optimise them: optimisation
 * is a training loop over thousands of reviews, and the published defaults are
 * a sound choice until a user has that much history.
 *
 * Decay is fixed at -0.5 (as in FSRS-5). FSRS-6 makes it a learnable
 * parameter, which is only worth having if you also run the optimiser.
 */

/** Default parameters (FSRS-5). Index meanings are documented per formula. */
export const DEFAULT_W = Object.freeze([
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575,
  0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655,
  0.6621,
]);

/** Power-law forgetting curve constants. FACTOR is chosen so R(S, S) === 0.9. */
export const DECAY = -0.5;
export const FACTOR = 19 / 81;

/** Stability is never allowed to collapse to zero. */
export const S_MIN = 0.01;

/** Ratings, matching the four answer buttons. */
export const AGAIN = 1;
export const HARD = 2;
export const GOOD = 3;
export const EASY = 4;
export const RATINGS = Object.freeze([AGAIN, HARD, GOOD, EASY]);

export const RATING_LABELS = Object.freeze({
  [AGAIN]: "Again",
  [HARD]: "Hard",
  [GOOD]: "Good",
  [EASY]: "Easy",
});

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * Probability of recalling an item `elapsedDays` after the last review.
 *   R(t, S) = (1 + FACTOR · t / S) ^ DECAY
 */
export function retrievability(elapsedDays, stability) {
  const t = Math.max(elapsedDays, 0);
  const s = Math.max(stability, S_MIN);
  return (1 + (FACTOR * t) / s) ** DECAY;
}

/**
 * Days to wait so recall probability decays exactly to `desiredRetention`.
 * Inverse of retrievability(); at retention 0.9 this returns S itself.
 */
export function intervalDays(stability, desiredRetention) {
  const s = Math.max(stability, S_MIN);
  return (s / FACTOR) * (desiredRetention ** (1 / DECAY) - 1);
}

/** S₀(G) = w[G−1] — stability implied by the very first answer. */
export function initialStability(rating, w = DEFAULT_W) {
  return Math.max(w[rating - 1], S_MIN);
}

/** D₀(G) = w₄ − e^(w₅·(G−1)) + 1, clamped to [1, 10]. */
export function initialDifficulty(rating, w = DEFAULT_W) {
  return clamp(w[4] - Math.exp(w[5] * (rating - 1)) + 1, 1, 10);
}

/**
 * Difficulty after a review: a grade-driven step, damped linearly as D
 * approaches 10 so hard items cannot run away, then mean-reverted towards
 * D₀(Easy) so nothing stays maximally difficult forever.
 */
export function nextDifficulty(difficulty, rating, w = DEFAULT_W) {
  const delta = -w[6] * (rating - 3);
  const damped = difficulty + delta * ((10 - difficulty) / 9);
  const reverted = w[7] * initialDifficulty(EASY, w) + (1 - w[7]) * damped;
  return clamp(reverted, 1, 10);
}

/**
 * Stability after a successful review (Hard/Good/Easy). The gain shrinks with
 * difficulty and with already-high stability, and grows as retrievability
 * falls — reviewing something you were about to forget teaches you more.
 */
export function nextRecallStability(difficulty, stability, r, rating, w = DEFAULT_W) {
  const hardPenalty = rating === HARD ? w[15] : 1;
  const easyBonus = rating === EASY ? w[16] : 1;
  const s = Math.max(stability, S_MIN);
  const increase =
    Math.exp(w[8]) *
    (11 - difficulty) *
    s ** -w[9] *
    (Math.exp(w[10] * (1 - r)) - 1) *
    hardPenalty *
    easyBonus;
  return Math.max(s * (1 + increase), S_MIN);
}

/**
 * Stability after a lapse. Clamped to the pre-lapse stability: forgetting an
 * item can never be evidence that you know it better than before.
 */
export function nextForgetStability(difficulty, stability, r, w = DEFAULT_W) {
  const s = Math.max(stability, S_MIN);
  const postLapse =
    w[11] * difficulty ** -w[12] * ((s + 1) ** w[13] - 1) * Math.exp(w[14] * (1 - r));
  return clamp(postLapse, S_MIN, s);
}

/**
 * Stability after a same-day review, where the long-term formulas do not apply
 * (elapsed time is ~0, so retrievability is ~1 and the recall formula would
 * report almost no gain). A passing grade may never *reduce* stability.
 *   S'(S, G) = S · e^(w₁₇·(G − 3 + w₁₈))
 */
export function shortTermStability(stability, rating, w = DEFAULT_W) {
  const s = Math.max(stability, S_MIN);
  const next = s * Math.exp(w[17] * (rating - 3 + w[18]));
  return Math.max(rating >= GOOD ? Math.max(next, s) : next, S_MIN);
}

/** Convenience wrapper: next stability for any rating. */
export function nextStability(difficulty, stability, r, rating, w = DEFAULT_W) {
  return rating === AGAIN
    ? nextForgetStability(difficulty, stability, r, w)
    : nextRecallStability(difficulty, stability, r, rating, w);
}

/**
 * Interval fuzz. Without it, cards introduced on the same day stay clumped
 * together for years. The ranges are the conventional ones; `rand` is
 * injectable so tests can be deterministic.
 */
export function applyFuzz(days, rand = Math.random) {
  if (days < 2.5) return days;
  const ranges = [
    [2.5, 7, 0.15],
    [7, 20, 0.1],
    [20, Infinity, 0.05],
  ];
  const [, , pct] = ranges.find(([lo, hi]) => days >= lo && days < hi);
  const delta = Math.max(1, days * pct);
  const min = Math.max(2, Math.round(days - delta));
  const max = Math.round(days + delta);
  return min + Math.floor(rand() * (max - min + 1));
}
