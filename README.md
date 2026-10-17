# UI Picker

An [Agent Wrangler](https://github.com/topics/agent-wrangler-extension) extension. Point at a
component in the enterprise web app, add a note and a screenshot, and start a wrangler session
about it.

## How it works

1. The bookmarklet asks Chrome to share the current tab. Share it to attach a screenshot, or
   Cancel to pick without one.
2. It highlights the element under the mouse. Click an element, or drag a rectangle around an
   area. A click picks that element; a drag picks the smallest element that contains the whole
   area. Either way it reads the React fiber for the element's JSX file:line and the chain of
   components that rendered it.
3. If you shared the tab, it grabs one frame, crops it to the element (with a small margin) or to
   the dragged area, and stops sharing straight away.
4. It opens a launch window served by your wrangler (`/ext/ui-picker/launch.html`) and hands the
   pick and the screenshot to it with `postMessage`. The enterprise page never talks to the
   wrangler directly, so no CORS or origin settings change.
5. In the launch window you write a note. The captured screenshot is attached already; paste
   another to replace it, or remove it. **Launch** starts a session in the enterprise repo (in a
   new worktree by default) with your note and the pick details as its prompt.

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

On the enterprise app (default `http://localhost:3333` or `:1234`), click the bookmark.

1. Chrome asks to share this tab. Choose **Share** to attach a screenshot, or **Cancel** to pick
   without one. Chrome asks every time: a web page can't skip that prompt.
2. Click an element, or drag to capture an area. `Esc` cancels.

Allow pop-ups for the site the first time. While sharing, Chrome's sharing bar appears at the top
of the tab; it goes away as soon as the screenshot is taken (or when you press `Esc`).
Only this tab can be captured: share another window or screen and the picker carries on without
a screenshot. Stopping sharing from Chrome's bar does the same, and you can then only click, not
drag.

If you cancelled the share, or the capture failed, you can still copy a screenshot with ⌘⇧⌃4 and
paste it into the launch window (PNG, up to 10 MB). A pasted screenshot replaces a captured one.

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
  close. The prompt tells the agent never to follow instructions found in it.

## Housekeeping

Screenshots are saved to `$AW_DATA_DIR/ui-picker/shots/` (or `~/.agent-wrangler/ui-picker/shots/`)
so the session can read them. They are not deleted automatically; clear the folder when you like.

## Development

```bash
npm test
```

No runtime dependencies. To try it on an isolated wrangler, copy (don't symlink — discovery skips
symlinks) this directory to `<AW_DATA_DIR>/extensions/ui-picker/` and restart that instance.
