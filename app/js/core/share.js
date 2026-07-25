/**
 * Getting a deck file out of the app and back in again.
 *
 * Out: the Web Share API with a file attachment, which on a phone opens the
 * system share sheet — Signal, WhatsApp, mail, whatever is installed. Desktop
 * browsers mostly cannot share files, so we fall back to a download.
 *
 * In: a file picker, drag-and-drop, and (when the app is installed) files
 * opened directly from the OS via the manifest's file_handlers.
 */

import { exportFilename, parsePayload, serialise } from "./codec.js";

const MIME = "application/json";

export function deckFile(deck, notes, now = Date.now()) {
  const text = serialise(deck, notes, now);
  return new File([text], exportFilename(deck, now), { type: MIME });
}

export const canShareFiles = (file) =>
  typeof navigator !== "undefined" &&
  typeof navigator.canShare === "function" &&
  typeof navigator.share === "function" &&
  navigator.canShare({ files: [file] });

/** Trigger a plain download. Also the fallback when sharing is unavailable. */
export function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Share a deck. Returns how it left the device so the UI can say something
 * accurate ("shared" vs "saved to your downloads").
 *
 * @returns {Promise<"shared"|"downloaded"|"cancelled">}
 */
export async function shareDeck(deck, notes, now = Date.now()) {
  const file = deckFile(deck, notes, now);

  if (canShareFiles(file)) {
    try {
      // Files only — no `title`, no `text`. iOS hands the receiving app the
      // text and silently drops the attachment when both are present, so
      // Signal would show "Sursilvan — 42 cards" and no deck.
      await navigator.share({ files: [file] });
      return "shared";
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
      // Share can fail for reasons the caller cannot fix (no target app, a
      // permissions policy). A download still gets the file to the user.
      downloadFile(file);
      return "downloaded";
    }
  }

  downloadFile(file);
  return "downloaded";
}

/** Read and validate a File chosen by the user. Throws PayloadError. */
export async function readDeckFile(file) {
  const text = await file.text();
  return parsePayload(text);
}

/** Open a file picker and return the parsed payload, or null if cancelled. */
export function pickDeckFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    // Deliberately broad: iOS greys out .json in the Files picker under a
    // narrow accept list, and a deck that arrived as .txt is still a deck.
    // parsePayload validates the contents regardless of what the name says.
    input.accept = ".json,.txt,application/json,text/plain";
    input.hidden = true;

    // There is no "cancel" event with universal support; the picker simply
    // never fires change. The element is cleaned up on the next selection or
    // when the page navigates, which is good enough for a hidden input.
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return resolve(null);
      try {
        resolve(await readDeckFile(file));
      } catch (error) {
        reject(error);
      }
    });

    document.body.append(input);
    input.click();
  });
}

/**
 * Wire drag-and-drop onto an element. Returns a teardown function.
 */
export function acceptDrops(element, { onPayload, onError, onOver } = {}) {
  const setOver = (over) => onOver?.(over);

  const onDragOver = (event) => {
    event.preventDefault();
    setOver(true);
  };
  const onDragLeave = () => setOver(false);
  const onDrop = async (event) => {
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    try {
      onPayload?.(await readDeckFile(file), file);
    } catch (error) {
      onError?.(error);
    }
  };

  element.addEventListener("dragover", onDragOver);
  element.addEventListener("dragleave", onDragLeave);
  element.addEventListener("drop", onDrop);

  return () => {
    element.removeEventListener("dragover", onDragOver);
    element.removeEventListener("dragleave", onDragLeave);
    element.removeEventListener("drop", onDrop);
  };
}

/**
 * Files handed to the installed app by the OS (Android's "open with").
 * Progressive enhancement: absent everywhere else, and the picker still works.
 */
export function onLaunchWithFile(handler) {
  if (!("launchQueue" in window)) return;
  window.launchQueue.setConsumer(async (params) => {
    const handle = params?.files?.[0];
    if (!handle) return;
    try {
      handler(await readDeckFile(await handle.getFile()));
    } catch (error) {
      handler(null, error);
    }
  });
}
