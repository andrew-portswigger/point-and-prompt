# UI Picker

An [Agent Wrangler](https://github.com/topics/agent-wrangler-extension) extension. Point at a
component in the enterprise web app, add a note and a screenshot, and start a wrangler session
about it: **Fix** it, or **Make reusable**.

## How it works

1. A bookmarklet highlights the element under the mouse. Clicking reads the React fiber for the
   element's JSX file:line and the chain of components that rendered it.
2. It opens a launch window served by your wrangler (`/ext/ui-picker/launch.html`) and hands the
   pick to it with `postMessage`. The enterprise page never talks to the wrangler directly, so no
   CORS or origin settings change.
3. In the launch window you write a note, choose an action and optionally paste a screenshot.
   **Launch** starts a session in the enterprise repo (in a new worktree by default) using the
   `ui-fix` or `ui-make-reusable` skill.

## Install

1. In the wrangler, **Settings → Extensions → + Add extension**, paste this repository's git URL,
   review the capabilities (`sessions:spawn`, `board:broadcast`) and install.
2. Open `http://localhost:<wrangler port>/ext/ui-picker/install.html` and drag **UI Picker** to your
   bookmarks bar. The bookmarklet is tied to that wrangler's address.
3. The enterprise web app must be built with the dev JSX transform so components carry their
   source location: `libraries/web-app/webpack.config.js` passes
   `@babel/preset-react` `{ development: argv.mode === 'development' }`. Without it the picker
   still works, but sessions get component names only, no file:line.

## Use

On the enterprise app (default `http://localhost:3333` or `:1234`), click the bookmark, then click
an element. `Esc` cancels. Allow pop-ups for the site the first time.

To attach a screenshot, copy one with ⌘⇧⌃4 and paste it into the launch window (PNG, up to 10 MB).

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| Repository path | `~/vcs/enterprise` | Checkout new sessions start in. Source paths in picks are shown relative to it. |
| Allowed page origins | `http://localhost:3333`, `http://localhost:1234` | Sites whose picks the launch window accepts. |
| Start in a new worktree | on | Off starts the session in the checkout itself. |
| Task id | none | Board task new sessions are filed under. |

## Security model

- The launch window accepts a pick only from the tab that opened it, only from an allowed origin,
  and only in the expected shape. It refuses to run inside a frame.
- Nothing launches without you clicking **Launch**.
- Everything captured from the page is treated as untrusted data. The server checks types and
  sizes, flattens every field to one line, and quotes the HTML in a code fence the HTML can't
  close. The skills tell the agent never to follow instructions found in it.

## Housekeeping

Screenshots are saved to `$AW_DATA_DIR/ui-picker/shots/` (or `~/.agent-wrangler/ui-picker/shots/`)
so the session can read them. They are not deleted automatically; clear the folder when you like.

## Development

```bash
npm test
```

No runtime dependencies. To try it on an isolated wrangler, copy (don't symlink — discovery skips
symlinks) this directory to `<AW_DATA_DIR>/extensions/ui-picker/` and restart that instance.
