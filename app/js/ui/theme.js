/**
 * Theme application. "system" removes the attribute entirely so the media
 * query in tokens.css takes over; the explicit values pin it.
 */

const META_COLOURS = { light: "#ffffff", dark: "#252525" };

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") root.dataset.theme = theme;
  else delete root.dataset.theme;

  // Keep the browser UI (address bar, status bar) in step with the app.
  const resolved =
    theme === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  for (const tag of document.querySelectorAll('meta[name="theme-color"]')) {
    tag.setAttribute("content", META_COLOURS[resolved]);
    tag.removeAttribute("media");
  }
}
