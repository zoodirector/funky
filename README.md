# Funky

Flashcards for learning a language, on your phone, offline. Spaced repetition
by [FSRS-5](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm),
a modern memory model. Decks are shared as files over any messenger, so two or
more people can build a card set together.

No build step, no dependencies, no backend. The repository contains only HTML,
CSS and JavaScript, served exactly as written.

## Running it

ES modules and service workers cannot load from `file://`, so it needs a static
file server. Any one will do:

```sh
python3 -m http.server 8000 --directory app
```

Then open <http://localhost:8000>. On a phone, open `http://<your-lan-ip>:8000`
and use "Add to home screen".

Nothing is compiled, bundled or minified — the files the browser loads are the
files in this repository.

## Deploying

Because there is nothing to build, deploying is a file copy to any static host.
`app/` is the whole site, so it ships as-is:

```sh
rsync -av --delete app/ user@host:www/funky/
```

`--delete` is what keeps the server honest: a module deleted here has to
disappear there too, so the served tree stays identical to the repository.

The service worker takes care of itself. Its bytes change on every deploy, so
browsers fetch the new one, and `activate` drops every cache whose name is not
the current `CACHE_NAME`. Adding or removing a file is the one case that needs a
hand — see [Adding a file](#adding-a-file).

## How it fits together

```
app/                    the site — everything below this is what gets deployed
  index.html            app shell
  manifest.webmanifest  installability, plus a file handler for .json decks
  sw.js                 cache-first service worker (its file list is hand-kept)

  css/   tokens · base · components · layout · views
  js/
    app.js              entry point — opens the db, registers routes, starts up
    core/               pure domain logic, no DOM
      fsrs.js           the FSRS-5 memory model
      scheduler.js      learning steps wrapped around FSRS
      queue.js          study day, daily limits, what comes next
      model.js          notes, cards, decks
      codec.js          the deck exchange format
      merge.js          merging a friend's deck into yours
      db.js             IndexedDB wrapper
      store.js          state and mutations
      share.js          Web Share API and file import
    ui/                 router, shell, theme, components, one module per view
  assets/               icon sources and the PNGs the manifest wants

vocabulari/             source word lists and the script that builds decks
```

`core/` is pure and testable; views read from `store.js` and never touch the
database directly.

## Two ideas worth knowing

**A note is shared, a card is private.** A _note_ is content — term,
translation, example, tags — and it is the only thing in an exported file. A
_card_ is one direction of that note (term→translation and translation→term are
two cards) together with your scheduling state. Card ids are derived from the
note id, so an incoming edit to a note you already have re-uses your existing
card. **An import can never reset your progress.**

**Merging converges.** Notes carry stable UUIDs, `modified` timestamps and
tombstones; merging is a union with last-write-wins per note. That makes it
commutative and idempotent: A⊕B equals B⊕A, and importing the same file twice
does nothing the second time. Everyone can export, everyone can import, in any
order, as often as they like.

## Sharing a deck

Deck menu → _Send to a friend_. On a phone this opens the system share sheet
(Signal, WhatsApp, mail); on desktop it downloads a `.json` file. The recipient
opens **Import** and picks the file, and sees exactly what will change before
anything is written.

The file is plain, pretty-printed JSON — readable and diffable, which matters
when two people are co-authoring a deck. It contains no scheduling state.

### Receiving on an iPhone

Sending out works everywhere. Coming back in is where iOS is different: **Funky
cannot appear in the share sheet**, so sharing a deck from Signal or WhatsApp
straight into the app is not possible. That is the platform, not the app —
WebKit has never implemented the [Web Share Target
API](https://bugs.webkit.org/show_bug.cgi?id=194593) (filed 2019, still open),
and `file_handlers` is Chromium-only. Nothing in a home screen web app can
register itself as a destination for a file.

So the import screen offers two ways in, and says so on iOS:

- **Save to Files.** In the messenger, tap the deck file → _Share_ → _Save to
  Files_. Then Import → _Choose file_.
- **Paste deck.** If the deck arrived as text, copy it and tap _Paste deck_.
  Safari asks for confirmation before handing the clipboard over; declining
  falls back to a box to paste into by hand.

If the two-step dance grates, a Shortcut gets Funky into the share sheet by
proxy: a shortcut set to _Show in Share Sheet_ accepting files, with _Get Text
from Input_ → _Copy to Clipboard_. Share the deck to it, open Funky, tap _Paste
deck_. Nothing in this repository depends on it; it is one recipe among several.

## Storage

Everything lives in IndexedDB in one browser on one device. There is no account
and no sync. Clearing site data deletes it, so sending a deck to a friend now and
then is also your backup.

## Icons

`app/assets/icon.svg` and `app/assets/icon-maskable.svg` are the sources. The
manifest wants PNGs alongside them, regenerated whenever a source changes:

```sh
rsvg-convert -w 192 -h 192 app/assets/icon.svg          -o app/assets/icon-192.png
rsvg-convert -w 512 -h 512 app/assets/icon.svg          -o app/assets/icon-512.png
rsvg-convert -w 512 -h 512 app/assets/icon-maskable.svg -o app/assets/icon-maskable-512.png
```

Without them the app runs normally; it just cannot be installed.

## Adding a file

There is no bundler to discover new modules, so a new `.js` or `.css` file must
be added to the `SHELL` list in `app/sw.js`, and `CACHE_VERSION` bumped so existing
installs pick it up. That is the only manual step the no-build-step constraint
costs.
