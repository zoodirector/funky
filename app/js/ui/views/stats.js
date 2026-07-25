/** Study statistics across all decks. */

import { html, mount } from "../dom.js";
import { setFlush, setHeader } from "../shell.js";
import * as store from "../../core/store.js";
import { dayIndex, dueForecast } from "../../core/queue.js";
import { currentRetrievability } from "../../core/scheduler.js";
import { STATE_NEW, STATE_REVIEW } from "../../core/model.js";
import { AGAIN } from "../../core/fsrs.js";

const FORECAST_DAYS = 14;

export async function render({ outlet }) {
  setFlush(false);
  setHeader({ title: "Stats" });

  const now = Date.now();
  const cutoff = store.getState().settings.dayCutoffHour;
  const cards = [...store.getState().cards.values()];
  const log = await store.reviewLog();

  const today = dayIndex(now, cutoff);
  const todayLog = log.filter((entry) => dayIndex(entry.reviewedAt, cutoff) === today);
  const last30 = log.filter((entry) => today - dayIndex(entry.reviewedAt, cutoff) < 30);

  const mature = cards.filter((c) => c.state === STATE_REVIEW && c.stability >= 21);
  const young = cards.filter((c) => c.state === STATE_REVIEW && c.stability < 21);
  const unseen = cards.filter((c) => c.state === STATE_NEW);

  const passed = last30.filter((entry) => entry.rating !== AGAIN).length;
  const retention = last30.length ? Math.round((passed / last30.length) * 100) : null;

  const predicted = cards
    .map((card) => currentRetrievability(card, now))
    .filter((r) => r != null);
  const avgRecall = predicted.length
    ? Math.round((predicted.reduce((a, b) => a + b, 0) / predicted.length) * 100)
    : null;

  const forecast = dueForecast(cards, now, FORECAST_DAYS, cutoff);
  const peak = Math.max(1, ...forecast);

  mount(
    outlet,
    cards.length
      ? html`<div class="section">
            <p class="section-title">Today</p>
            <div class="stat-grid">
              ${tile(todayLog.length, "cards answered")}
              ${tile(todayLog.filter((e) => e.wasNew).length, "new cards seen")}
            </div>
          </div>

          <div class="section">
            <p class="section-title">Collection</p>
            <div class="stat-grid">
              ${tile(mature.length, "mature (21d+)")} ${tile(young.length, "young")}
              ${tile(unseen.length, "unseen")}
              ${tile(cards.filter((c) => c.suspended).length, "suspended")}
            </div>
          </div>

          <div class="section">
            <p class="section-title">Recall</p>
            <div class="stat-grid">
              ${tile(retention == null ? "—" : `${retention}%`, "answered correctly (30d)")}
              ${tile(avgRecall == null ? "—" : `${avgRecall}%`, "predicted recall now")}
            </div>
          </div>

          <div class="section">
            <p class="section-title">Due in the next fortnight</p>
            <div class="card">
              <div class="card-body">
                <div class="forecast" role="img" aria-label="${forecastLabel(forecast)}">
                  ${forecast.map(
                    (count, index) => html`<div class="forecast-col">
                      <div
                        class="forecast-bar"
                        style="height: ${Math.round((count / peak) * 100)}%"
                      ></div>
                      <span class="forecast-label">${index % 2 === 0 ? index : ""}</span>
                    </div>`
                  )}
                </div>
                <p class="text-sm muted" style="margin-top: 0.5rem; text-align: center">
                  days from today
                </p>
              </div>
            </div>
          </div>`
      : html`<div class="empty">
          <span class="empty-icon" aria-hidden="true">📈</span>
          <p class="empty-title">No cards yet</p>
          <p>Statistics appear once you have a deck to study.</p>
        </div>`
  );
}

const tile = (value, label) =>
  html`<div class="card stat-tile">
    <div class="stat-value">${value}</div>
    <div class="stat-label">${label}</div>
  </div>`;

const forecastLabel = (forecast) =>
  `Cards due per day for the next ${forecast.length} days: ${forecast.join(", ")}`;
