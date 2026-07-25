/**
 * Hash routing. The hash keeps the app working from any static path — a file
 * server, a subdirectory, GitHub Pages — with no server rewrite rules, which
 * matters when there is no server logic at all.
 *
 * A route module exports `render({ params, outlet, ... })` and may return a
 * teardown function, called before the next route renders. That is how the
 * review view detaches its keyboard handler and timers.
 */

const routes = [];
let outlet = null;
let context = {};
let teardown = null;
let current = null;

/** "#/deck/:id" → { pattern, keys } */
function compile(path) {
  const keys = [];
  const pattern = new RegExp(
    `^${path
      .replace(/\/:([^/]+)/g, (_, key) => {
        keys.push(key);
        return "/([^/]+)";
      })
      .replace(/\//g, "\\/")}$`
  );
  return { pattern, keys };
}

export function route(path, view) {
  routes.push({ path, view, ...compile(path) });
}

export const currentPath = () => location.hash.slice(1) || "/";

export function navigate(path, { replace = false } = {}) {
  const target = `#${path}`;
  if (location.hash === target) return;
  if (replace) location.replace(target);
  else location.hash = target;
}

export const back = () => history.back();

function match(path) {
  for (const entry of routes) {
    const found = path.match(entry.pattern);
    if (found) {
      const params = Object.fromEntries(entry.keys.map((key, i) => [key, decodeURIComponent(found[i + 1])]));
      return { entry, params };
    }
  }
  return null;
}

async function handle() {
  const path = currentPath();
  const found = match(path);

  if (!found) {
    navigate("/decks", { replace: true });
    return;
  }

  teardown?.();
  teardown = null;
  current = { path, params: found.params, name: found.entry.path };

  const result = await found.entry.view.render({
    params: found.params,
    outlet,
    path,
    ...context,
  });

  if (typeof result === "function") teardown = result;
  // A fresh view starts at the top; without this, moving from a long deck list
  // into a note editor lands mid-page.
  outlet.scrollTop = 0;
}

export function start({ outlet: element, context: ctx = {} }) {
  outlet = element;
  context = ctx;
  window.addEventListener("hashchange", handle);
  return handle();
}

/** Re-run the current route, e.g. after a mutation that changes its data. */
export const refresh = () => handle();

export const getCurrent = () => current;
