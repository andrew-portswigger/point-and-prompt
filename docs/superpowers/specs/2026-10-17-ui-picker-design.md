# UI Picker — design

**Date:** 2026-10-17
**Status:** Draft, awaiting review

## Goal

From the running enterprise web app, point at a piece of the UI and start an Agent Wrangler
session about it. Typical asks: "this is wrong, fix it" with a screenshot, or "make this
component reusable".

## Non-goals

- Picking a model, effort or task at launch. The launch is note + action + screenshot only.
- Automatic screenshots. The user pastes one.
- Any change to Agent Wrangler core, or to the enterprise origin/CSP posture.
- Chrome extensions (blocked by policy) and dev-server proxies.

## Overview

Three parts, two repositories:

| Part | Lives in | Runs on |
| --- | --- | --- |
| Bookmarklet (picker) | this repo, `public/bookmarklet.js` | the enterprise page |
| Launch page + server handler + skills | this repo (the wrangler extension `ui-picker`) | the wrangler origin / wrangler server |
| JSX dev transform flag | enterprise, `libraries/web-app` | the enterprise build |

```
enterprise page                       wrangler origin (popup)                 wrangler server
───────────────                       ───────────────────────                 ───────────────
click bookmarklet
hover highlight, click element
read React fiber → payload
window.open(/ext/ui-picker/launch.html) ──► page loads
                         ◄── postMessage {type:'ui-picker:ready'}
postMessage(payload, wranglerOrigin) ──►    check origin + type
                                            show pick, note, action, paste
                                            [Launch] ── WS frame ───────────► ui-picker-launch handler
                                                                              save PNG, spawn session
                                            ◄── broadcast {requestId, sessionId}
                                            "Launched" + close
```

## Why this shape (decisions already made)

- **No origin is allowed, nothing is proxied.** The wrangler's `/ws` and `POST /mcp` refuse
  foreign `Origin` headers (`server/origin-check.js`) because they can spawn sessions, i.e. run
  code. The enterprise page never talks to the wrangler; it hands data to a popup that is
  already same-origin with the wrangler.
- **The Launch click is the CSRF gate.** Any site can open the popup and `postMessage` it, so
  nothing launches without a human click in the popup, and the popup only accepts messages from
  configured enterprise origins.
- **Self-contained bookmarklet.** The enterprise CSP (`ContentSecurityPolicyFactory`:
  `script-src 'self' …`, `connect-src 'self' …`) blocks loading or fetching from the wrangler.
  Spike 1 confirmed Chrome still runs a bookmarklet under that exact CSP and that
  `window.open` + `postMessage` to another origin works. No COOP header is set by enterprise.
- **Paste for screenshots.** A bookmarklet cannot screenshot reliably without a ~200KB library.

## Part 1 — Bookmarklet

Built from `public/pick-core.js` + `public/bookmarklet-main.js` into a `javascript:` URL (URL-encoded, not minified; a few KB). The wrangler
origin is baked in at build time from the page that serves the drag link (see Part 2), so the
bookmarklet always targets the wrangler that issued it.

Behaviour:

1. Overlay a highlight box that follows the element under the cursor (capture-phase
   `mousemove`). `Esc` cancels and removes all listeners.
2. On click (capture phase, `preventDefault` + `stopPropagation` so the app doesn't react),
   build the payload and tear down the overlay.
3. `window.open('<wrangler>/ext/ui-picker/launch.html', 'ui-picker')`, wait for the popup's
   `ui-picker:ready` message (checking `event.source === popup`), then
   `popup.postMessage(payload, '<wrangler origin>')`. Exact target origin, never `'*'`.

Payload (`type: 'ui-picker:pick'`, `version: 1`):

| Field | Source |
| --- | --- |
| `url` | `location.href` |
| `element` | tag, id, first few classes, trimmed text (≤200 chars) |
| `html` | `outerHTML`, truncated to 4KB |
| `jsxAt` | clicked element's fiber `_debugSource` → `fileName:lineNumber` (null if absent) |
| `owners` | `_debugOwner` chain, up to 8: `{ name, at }` where `at` is that fiber's `_debugSource` |
| `rect` | `getBoundingClientRect()` + `devicePixelRatio` (helps the user crop / agent orient) |

Fiber lookup: the element's own `__reactFiber$*` key, walking up `parentElement` until one is
found. If none is found (non-React page) the payload still goes, with `jsxAt: null, owners: []`.
`fileName` is absolute; it is sent as-is and relativised by the server against the configured
repo path.

Spike 2 confirmed `_debugSource` is present once the enterprise build uses the dev JSX
transform. `jsxAt` is where the element is *written* in JSX; owners give the component chain
that rendered it. Both are needed: "make this reusable" usually targets the nearest owner, "fix
this" often the JSX site.

## Part 2 — Wrangler extension `ui-picker`

Repository layout:

```
package.json            wranglerExtension { id: 'ui-picker', requires: [...] }
index.js                manifest
server/launch.js        ui-picker-launch handler
server/prompt.js        builds the session intent (pure, unit-tested)
public/launch.html      popup page
public/launch.js
public/bookmarklet.js   picker source
public/install.html     drag-to-bookmarks page
skills/ui-fix/SKILL.md
skills/ui-make-reusable/SKILL.md
```

No runtime dependencies, so no lockfile and no `npm ci` on install.

**Manifest**

- `requires`: `sessions:spawn`, `board:broadcast`. Nothing else: `spawn({ taskId })` binds the
  task itself, and Node modules (`fs`, `path`) are imported directly, not declared. An unknown
  capability quarantines the extension.
- `handlers`: `ui-picker-launch`.
- `skills`: `ui-fix`, `ui-make-reusable`.
- `help`: one line including the plain path `/ext/ui-picker/install.html` (help text renders as
  text, not a link).
- `settings`:
  - `repoPath` (text) — enterprise checkout to launch in, default `~/vcs/enterprise`. The handler
    expands `~` itself before relativising paths (core only expands `cwd`).
  - `allowedOrigins` (list) — enterprise origins whose picks the popup accepts, default
    `http://localhost:3333`, `http://localhost:1234`.
  - `useWorktree` (toggle, default on).
  - `taskId` (text, optional) — task new sessions are filed under.

**Install page** (`/ext/ui-picker/install.html`) — generates the bookmarklet link with
`location.origin` baked in and tells the user to drag it to the bookmarks bar. Reached by typing
the path from the extension's help text. (A clickable link in Settings would need a client
module with a `settings.panel` slot; not worth it for v1.)

**Launch page** (`/ext/ui-picker/launch.html`)

- On load: open a WebSocket to `/ws` (same origin, so it passes the Origin gate; no other
  handshake exists). Read `allowedOrigins` from the first board graph frame
  (`graph.extensions[]` entry for `ui-picker`, `settingValues`). Only then post
  `window.opener?.postMessage({ type: 'ui-picker:ready' }, '*')`. `'*'` is safe here: the message
  carries nothing. The socket also streams board state; the page ignores it.
- Listens for `message`; accepts only `event.origin ∈ allowedOrigins` **and**
  `data.type === 'ui-picker:pick'`; ignores everything else silently (React DevTools alone posts
  ~2 messages/s into every page — seen in spike 1). First accepted pick wins.
- `allowedOrigins` comes from the server, not the bookmarklet, so a settings change takes effect
  without reinstalling the bookmarklet.
- Shows: page URL, element summary, `jsxAt`, owner chain; a note textarea; action radio
  (**Fix** / **Make reusable**); a paste target (`paste` event, first `image/png` item, shown as a
  thumbnail, removable; other image types get a "PNG only" hint); **Launch** and **Cancel**.
- Launch is disabled until a pick has arrived and the note is non-empty.
- On Launch: on the same socket, send
  `{ type: 'ui-picker-launch', requestId, pick, note, action, screenshot: <base64 PNG | null> }`
  (the `ws` default 100 MiB frame cap is ample). Handlers cannot reply to the sender, so wait for a
  broadcast frame with `type === 'ext:ui-picker'` and the matching `requestId` (every board tab
  receives it too and ignores it). Show "Launched" and close after 2s. An `{type:'error'}` frame
  (no `requestId`, but this socket only ever has one request in flight) or a 60s timeout shows
  the error and keeps the form so nothing typed is lost.

**Server handler** `ui-picker-launch`

1. Validate: `action ∈ {fix, reusable}`, note is a non-empty string ≤ 4KB, pick has the expected
   shape, screenshot (if any) is a PNG data URL ≤ 10MB decoded whose bytes start with the PNG signature. Throw on anything else (the
   router turns it into `{type:'error'}`).
2. Save the screenshot to `<data dir>/ui-picker/shots/<timestamp>-<requestId>.png`. The host API
   exposes no data dir, so resolve it as `process.env.AW_DATA_DIR` (`~` expanded) or else
   `~/.agent-wrangler`. The directory must be absolute (`addDirs` requires it).
3. Relativise `jsxAt` / owner paths against `repoPath` (leave absolute if outside it).
4. Build the intent with `prompt.js`:
   - First line names the skill in prose: "Use the `ui-fix` skill." / "Use the
     `ui-make-reusable` skill." Extension skills load as one-skill plugins, so the slash command's
     exact name isn't guaranteed; prose resolves either way.
   - Note, page URL, element summary, JSX site, owner chain, trimmed HTML, screenshot path.
5. `host.sessions.spawn({ cwd: repoPath, intent, worktree: useWorktree ? { auto: true } : undefined,
   addDirs: [shotsDir], taskId })`.
6. `host.broadcast({ requestId, sessionId })` — arrives as `type: 'ext:ui-picker'`.

The pick is untrusted page data; it goes into the prompt as quoted context, never as
instructions, and the skills say so.

**Skills**

- `ui-fix` — reproduce from the URL/screenshot, locate via JSX site and owners, fix, verify in the
  running app where possible.
- `ui-make-reusable` — target the nearest sensible owner component, check for an existing
  equivalent in the shared UI library first, extract with a minimal prop surface, replace the
  original usage, then run `/fearless-component-check`.

Both start by opening the screenshot if one is given and treating the pick context as data.

## Part 3 — Enterprise change

In `libraries/web-app`, enable `@babel/preset-react`'s `development` option for development
builds only. It must key off webpack's `--mode`, **not** `process.env.NODE_ENV` (unset when
babel-loader runs, which would leak `_debugSource` paths into production bundles). Pass it via
the babel-loader `options` in `webpack.config.js` where `argv.mode` is in scope. Separate PR in
the enterprise repo, with a check that a production build contains no `__source`.

## Error handling

| Failure | Behaviour |
| --- | --- |
| Popup blocked | Bookmarklet shows a fixed banner: "Allow popups for this site". |
| No React fiber / no `_debugSource` | Pick still sent; launch page shows "no source info"; prompt says so. |
| Pick from a non-allowed origin | Ignored; page says "Waiting for a pick from an allowed site" with the configured list. |
| Extension disabled | `/ext/ui-picker/*` 404s; bookmarklet's popup shows the 404 — acceptable. |
| Spawn fails / bad input | Handler throws → `{type:'error'}` → shown in the popup, form kept. |
| No broadcast within 60s | Timeout message; session may still have launched — check the board. |

## Testing

- `prompt.js`: unit tests for intent building and path relativising (node test runner).
- Handler: unit tests with a fake `host` (spawn args, screenshot written, broadcast sent, each
  validation rejection).
- Launch page message filtering: unit test the accept predicate (origin + type).
- Bookmarklet fiber walk: unit test against a fake DOM node with hand-built fiber objects.
- End to end, manual: install into an isolated wrangler (`run-dev` skill), drag the bookmarklet,
  pick on the enterprise dev server, paste a screenshot, Launch, confirm the card appears with the
  right intent and the agent can open the PNG.
