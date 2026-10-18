# Point & Prompt

An [Agent Wrangler](https://github.com/topics/agent-wrangler-extension) extension. Point at part
of a React app's UI — click a component or drag around an area — and start an Agent Wrangler
session about it in the normal new-session dialog, with the component's source location and a
screenshot attached.

The defaults target DAST: the repository path is `~/vcs/enterprise` and the allowed page origins
are `http://localhost:3333` and `http://localhost:1234`. Change both in the settings for any other
app. Source file:line needs a React 17 or 18 development build; otherwise picks name the
components only.

Requires an Agent Wrangler with host API 1.36.0 or later, and Chrome. Firefox can share a window or screen but not a single tab, so screenshots (and dragging, which needs one) only work in Chrome.

## How it works

1. The bookmarklet asks Chrome to share the current tab. Share it to attach a screenshot, or
   Cancel to pick without one.
2. It highlights the element under the mouse. Click an element, or drag a rectangle around an
   area. A click picks that element; a drag picks the smallest element that contains the whole
   area. Either way it reads the React fiber for the element's JSX file:line and the chain of
   components that rendered it. A drag also lists the components inside the area (outermost
   first, up to 10). Components are found from the elements they render: one counts as inside
   when every element it renders (directly or through other components) is at least 60% inside
   the area, so a component that renders nothing inside the area isn't listed.
   While you drag, faint outlines with name tags show the components that will be listed, and a
   fainter dashed one shows the element that contains the area.
3. If you shared the tab, it grabs one frame, crops it to the element (with a small margin) or to
   the dragged area, and stops sharing straight away.
4. It opens your wrangler's board in a pop-up (`/?point-and-prompt=1`) and hands the pick and the
   screenshot to it with `postMessage`. The app's page never talks to the wrangler directly,
   so no CORS or origin settings change.
5. The extension's client module, running in that board, uploads the screenshot and opens the
   board's own new-session dialog: the folder is the app's repository, the prompt holds the pick
   details below an empty first line, and the screenshot is attached as an image. Type your note
   on the first line, pick the model, effort, worktree and task as for any session, and launch.
   The agent sees the screenshot directly. The pop-up closes once you launch or cancel.

## Install

1. In the wrangler, **Settings → Extensions → + Add extension**, paste this repository's git URL
   and install. It asks for no host capabilities.
2. Open **Settings → Extensions → Point & Prompt** and follow the steps there: drag
   **👉 Point & Prompt** to your bookmarks bar (Chrome can't give a bookmarklet a favicon, so the emoji stands in). The bookmarklet is tied to that wrangler's address, so
   reinstall it if the wrangler moves.
3. Source file:line needs a React 17 or 18 development build (DAST's dev build is one);
   production builds give component names only.

## Use

On your app (DAST by default: `http://localhost:3333` or `:1234`), click the bookmark.

1. Chrome asks to share this tab. Choose **Share** to attach a screenshot, or **Cancel** to pick
   without one. Chrome asks every time: a web page can't skip that prompt.
2. Click an element, or drag to capture an area. `Esc` cancels.

Allow pop-ups for the site the first time. The board takes a few seconds to load in the pop-up;
if it hasn't said it's ready within 30 seconds the bookmarklet gives up with a banner. While sharing, Chrome's sharing bar appears at the top
of the tab; it goes away as soon as the screenshot is taken (or when you press `Esc`).
Only this tab can be captured: share another window or screen and the bookmarklet carries on without
a screenshot. Stopping sharing from Chrome's bar does the same, and you can then only click, not
drag.

If you cancelled the share, or the capture failed, you can still copy a screenshot with ⌘⇧⌃4 and
paste it into the dialog's prompt box, as for any session. If the captured screenshot can't be
uploaded, the dialog opens without it and the board says so.

## Settings

Both settings live in the extension's panel under **Settings → Extensions → Point & Prompt**. Edit them
there and press **Save**; an allowed origin that isn't a bare `http(s)://host[:port]` is refused
with a message naming it, and nothing is saved.

| Setting | Default | Meaning |
| --- | --- | --- |
| Repository path | `~/vcs/enterprise` | Folder the new-session dialog starts in. Source paths in picks are shown relative to it. |
| Allowed page origins | `http://localhost:3333`, `http://localhost:1234` | Sites whose picks the board accepts. |

Worktree, task, model and effort are chosen in the dialog, which remembers your last choices.

## Versions

The bookmarklet holds its own copy of the pick code, so it doesn't change when the extension
updates; only re-dragging it from **Settings → Extensions → Point & Prompt** does. The two sides agree
on a wire protocol when the board says it's ready: the board lists every protocol it accepts, and
the bookmarklet sends the pick in the highest one both speak. The board also says which
bookmarklet build it hands out now.

- When the extension updates, bookmarklets you already have keep working as long as the board
  still accepts their protocol. If the bookmarklet's build differs from the board's, the pick goes
  through as usual and a banner on the app's page suggests re-dragging it.
- If the two share no protocol, you're told straight away (on the page or on the board) to
  re-drag the bookmarklet, rather than waiting for a timeout. A pick the board can't read gets the
  same advice.
- A protocol can gain optional fields without a new protocol number: the pick still reads
  without them, so old bookmarklets that don't send them and old boards that ignore them both
  keep working. Protocol 1's are `screenshot`, `mode` (`"drag"` for a drag; absent for a click)
  and `contains` (the components inside a dragged area). A malformed optional field is dropped
  and the pick goes through; only `screenshot`, there from the start, rejects the pick instead.
- Bookmarklets dragged before protocol versioning existed send `version` instead of `protocol`.
  The board shows them the mismatch card; re-drag once and you're on the versioned scheme.

## Security model

- The board acts only when opened as `/?point-and-prompt=1` by another window, and not inside a frame.
  It accepts one pick, only from the tab that opened it, only from an allowed origin, and only in
  the expected shape and size (screenshot: PNG data URL, up to 10 MB; the board's upload checks
  the bytes too).
- Nothing launches without you clicking **Launch** in the dialog.
- Everything captured from the page is treated as untrusted data. Every field is flattened to one
  line and the HTML is quoted in a code fence it can't close. The prompt tells the agent never to
  follow instructions found in it.

## Development

```bash
npm test
```

**The fixtures are compatibility contracts: never edit them.** `test/fixtures/pick-v<N>.json` holds
a real payload for each protocol the board accepts, and a test pins every fixture's content hash.
For a new protocol, add `pick-v<N+1>.json` instead.

Adding a field that a pick can do without (one the board can read the pick without, and one old
boards can safely ignore) needs no new protocol. List it in `OPTIONAL_FIELDS` in
`public/defaults.js`, have the normaliser keep it when well formed and drop it otherwise, and add a
fixture carrying it (for example `pick-v1-contains.json`) with its hash pinned in
`test/pick-check.test.js`. The bookmarklet's output must be the protocol's fixture keys plus
some of its optional fields; a field the board can't do without needs a new protocol. Supporting one means adding it to
`SUPPORTED_PROTOCOLS` in `public/defaults.js`, a normaliser in `public/pick-check.js`, a payload
builder in `public/pick-core.js` and its fixture. Keep the old ones so that bookmarklets people
already have keep working.

No runtime dependencies. To try it on an isolated wrangler, copy (don't symlink — discovery skips
symlinks) this directory to `<AW_DATA_DIR>/extensions/point-and-prompt/` and restart that instance.
