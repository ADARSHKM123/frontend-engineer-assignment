# Figr Board Viewer

The viewer for a design tool: a board of 24 live previews of web pages, each in a
cross-origin `<iframe>`. You can hover, select and inspect any element inside any
preview; the app draws outlines and labels on top of each preview, and shows a
layers panel and an inspector for the selection.

Built with **React 18 + Vite + Zustand**, plain JavaScript and plain CSS.

Brief: [doc.figr.design/frontend-engineer](https://doc.figr.design/frontend-engineer) · The full original brief is at the [bottom of this file](#assignment-brief).

---

## Contents

1. [Run it](#run-it)
2. [What's built](#whats-built)
3. [The main decisions](#the-main-decisions)
4. [Architecture](#architecture)
5. [How state is organised](#how-state-is-organised)
6. [How the host and the pages talk](#how-the-host-and-the-pages-talk)
7. [Element identity across re-renders and navigation](#element-identity-across-re-renders-and-navigation)
8. [Failures](#failures)
9. [Ambiguous requirements and what I decided](#ambiguous-requirements-and-what-i-decided)
10. [Where this breaks](#where-this-breaks)
11. [With another week](#with-another-week)
12. [Assignment brief](#assignment-brief)

---

## Run it

Node 18 or newer.

```bash
npm install
npm run dev
```

Then open **http://localhost:5173**.

`npm run dev` starts all three servers with one command (via `concurrently`):

| Port | What | Started by |
|---|---|---|
| 5173 | the app (the "host") | `vite frontend` |
| 4000 | the API: `GET /screens`, `GET /elements/:key` | `node backend/server.js` |
| 4001 | the preview pages (a different origin from the app) | `node backend/server.js` |

In development, a **Dev** button in the toolbar triggers every failure on demand
(R6.7). It is removed from production builds (`npm run build`).

---

## What's built

| Req | What | Main code |
|---|---|---|
| R1 | Board of 24 previews; drag and wheel pan; Ctrl/Cmd + wheel zoom 25–400 % centred on the pointer, also over a preview; Select / Interact modes (toolbar, V, I) | `Board.jsx`, `store.js` (`camera`), `modeSync.js`, `agent.js` |
| R2 | 1 px hover outline + name label, one hover on the whole board, works on disabled controls, SVG and under sticky headers | `hoverSync.js`, `Outline.jsx`, `agent.js` (hover loop) |
| R3 | 2 px selection, Shift + click, Escape / background / empty board clears, outlines glued and clipped, keyboard navigation, selection survives page re-renders, clears on navigation | `selectionSync.js`, `keyboard.js`, `agent.js` (ids, fingerprints) |
| R4 | Layers panel: lazy loading with 3 s timeout + per-row Retry, hover and selection sync both ways, arrow keys, per-preview memory, live updates from page DOM changes, search over the whole page | `layersSync.js`, `layersTree.js`, `LayersPanel.jsx`, `agent.js` |
| R5 | Inspector: live values from the page, Details from the API (No details / 404 / error + Retry), "N elements" with "Mixed", only the latest selection's details | `Inspector.jsx`, `detailsSync.js`, `api.js` |
| R6 | Failure regions with Retry, 10 s preview connection timeout, "Page error" badge, one `report()` per failure from anywhere, dev menu | `regions.js`, `RegionBoundary.jsx`, `previewSync.js`, `DevMenu.jsx` |

---

## The main decisions

**1. One small script inside every page (the "agent") does everything that needs the page's DOM.**
The previews are on another origin, so the host cannot read them, listen inside
them or measure their elements. The brief allows one `<script>` per page; that
script (`backend/pages/agent.js`) finds elements, measures them, blocks clicks in
Select mode and reports changes. The host and the agent only exchange plain data
through `postMessage`.

> The page **observes and reports**. The host **decides and draws**.

**2. The host never holds a page's DOM node; elements are referred to by ids.**
The agent gives each element it mentions a short id (`e1`, `e2`, …). Hover,
selection, layers rows and the inspector all use these ids. When a page rebuilds
its DOM, the agent moves the id onto the new node (see
[identity](#element-identity-across-re-renders-and-navigation)), so nothing in
the host has to change.

**3. One Zustand store is the single source of truth.**
Mode, camera, hover, selection, layer trees, details, failures: all in
`store.js`, changed only through its actions. Pages hold copies (for example the
current mode) that the host keeps in sync. Zustand rather than Redux: much of the
state is changed from outside React (the message bridge, timers), and Zustand's
`getState()` / `subscribe()` make that direct, with less code to read.

**4. Outlines are drawn inside each preview, in the page's own coordinates.**
The agent sends an element's box in page pixels; the outline is a `div` inside
the preview frame at exactly those numbers. The board's single
`translate() scale()` transform then pans and zooms page and outline together, and
the frame's `overflow: hidden` clips outlines to the preview (R3.4). Sizes that
must stay constant on screen (1 px lines, 2 px lines, labels, names) are divided
by `--zoom` in CSS.

**5. Measure every animation frame instead of listening to every possible cause of movement.**
While something is hovered or selected, the agent re-checks it once per frame and
sends only what changed. That one loop covers page scroll, inner scroll areas,
resizes, animations and re-renders, and it runs only in the pages that need it.

**6. Every failure goes through one function.**
`failRegion()` shows the error in its region, reports it exactly once, and ignores
regions that are gone. Render errors reach it from React error boundaries; errors
from handlers, timers and messages reach it through the `inRegion()` wrapper.

**Prior art.** The hover / selection colours and the `V` shortcut follow Figma's
conventions, so the tool feels familiar to designers.

---

## Architecture

```
  ┌──────────────────────────────── HOST  localhost:5173 ────────────────────────────────┐
  │                                                                                        │
  │  components/        App ─ Board ─ Preview ─ Outline      LayersPanel     Inspector     │
  │                      ▲  (read the store with selectors, call actions on events)        │
  │  store.js           single source of truth (Zustand)                                   │
  │                      ▲                                                                 │
  │  *Sync.js           one module per feature: modeSync, hoverSync, selectionSync,        │
  │                     layersSync, detailsSync, previewSync, keyboard                     │
  │                      ▲                                                                 │
  │  bridge.js          the ONLY place messages from pages arrive; checks, then routes     │
  │  regions.js         failRegion / inRegion: every failure ends here                     │
  └──────────────────────▲──────────────────────────────────────────────▲──────────────────┘
                         │ postMessage (both ways)                       │ fetch
  ┌──────────────────────┴──── PAGES  localhost:4001 ────┐    ┌──────────┴──── API :4000 ──┐
  │  page-N.html  + <script src="/agent.js">             │    │  GET /screens               │
  │  agent.js: hit-testing, measuring, ids, fingerprints,│    │  GET /elements/:key         │
  │            click blocking, MutationObserver, search  │    └─────────────────────────────┘
  └──────────────────────────────────────────────────────┘
```

### Files

```
backend/pages/agent.js        the script inside every page (each page got exactly one <script> line)
frontend/src/
  main.jsx                    starts the global listeners, renders <App/>
  config.js                   API and pages addresses
  api.js                      fetch helper: 5xx, broken JSON and bad shapes become errors; 404 is not one
  store.js                    all shared state + the only functions allowed to change it
  bridge.js                   receives and checks every page message, sends messages to pages
  regions.js                  failRegion / inRegion (R6)
  keyboard.js                 V, I, Escape, Enter, Tab (from the host or forwarded from a page)
  modeSync.js                 keeps every page told the current mode
  hoverSync.js                page hover → store; layers row hover → page
  selectionSync.js            clicks, selection boxes, keyboard navigation
  layersTree.js               pure functions on a layers tree
  layersSync.js               loading, timeouts, reveal, arrow keys, scroll memory, live updates, search
  detailsSync.js              GET /elements/:key with cancellation
  previewSync.js              10 s connection timeout, page error badges
  components/
    App.jsx, Board.jsx, Preview.jsx, Outline.jsx, LayersPanel.jsx, Inspector.jsx
    RegionBoundary.jsx        error boundary per region
    DevMenu.jsx               dev-only failure triggers
frontend/report.js            the starter kit's report() stub (unchanged)
```

---

## How state is organised

**Rule:** shared state lives in the store and only changes through the store's
actions. Components read it with selectors and call actions; they never mutate it.
Pages never decide anything: they report facts, and the host's store applies the rules.

### In the store (`store.js`)

| State | What it is | Changed by (action → caller) |
|---|---|---|
| `mode` | `"select"` / `"interact"` | `setMode` ← toolbar, `keyboard.js` |
| `screens`, `screensStatus`, `screensError` | the board's data | `loadScreens` ← `Board` mount, Retry, dev menu |
| `camera` `{x, y, zoom}` | pan and zoom | `panBy`, `zoomAt` ← `Board` (wheel, drag, page zoom message) |
| `hover` `{screenId, id, name, rect, ancestors}` | the one hovered element on the board | `setHover`, `clearHover` ← `hoverSync.js` |
| `activeScreenId` | the preview last clicked in Select mode | `pickElement` ← `selectionSync.js`, `layersSync.js` |
| `selection` `{screenId, ids}` | ids in selection order (last = most recent) | `pickElement`, `selectOnly`, `clearSelection`, `setSelectionBoxes` |
| `selectionBoxes` | where each selected element is, plus its live values | `setSelectionBoxes` ← `selectionSync.js` |
| `selectionGone` | "This element no longer exists" | `setSelectionBoxes` (sets), `pickElement` / `selectOnly` (clear) |
| `layers[screenId]` | one tree per preview: rows, children, status, expanded | `updateLayers`, `resetLayers` ← `layersSync.js` only |
| `layersSearch`, `searchResults` | the search box and its results per preview | `layersSync.js` only |
| `details` `{status, data, error}` | the Details section | `setDetails` ← `detailsSync.js` only |
| `connections`, `pageErrors` | per preview: connected / failed, last page error | `previewSync.js` only |
| `regionErrors` | regions that failed outside rendering | `regions.js` only (set); `RegionBoundary` Retry (clear) |
| `dev` | dev-menu switches | `DevMenu.jsx` only |

### Outside the store, on purpose

Some state is never drawn, so it lives in plain module variables, where changing
it doesn't re-render anything:

| Where | What |
|---|---|
| `layersSync.js` | pending child requests and their 3 s timers; search timers; the panel's scroll position per preview; the open rows saved when a search started |
| `detailsSync.js` | the current details request and its `AbortController` |
| `store.js` | the current `/screens` request and its `AbortController` |
| `previewSync.js` | 10 s connection timers; "has this page said ready since it loaded?" |
| `bridge.js` | the message handlers registered by each feature |

### In each page (`agent.js`)

Copies and caches only, set by the host or derived from the DOM: the current mode,
the id registry, fingerprints, the selected ids to measure, the parents whose
children the panel has loaded ("watched"), the current search query, and the
pointer / row-hover position.

---

## How the host and the pages talk

Every message is a plain object. Page → host messages carry `source: "figr-agent"`,
host → page messages carry `source: "figr-host"`.

**Checks.** The host accepts a message only if `event.origin` is the pages origin,
it carries `figr-agent`, and `event.source` is one of the board's own iframes
(`bridge.js`). The agent accepts orders only from `window.parent`. The agent posts
with target `"*"` because it cannot know the host's address; none of its messages
are secret, and the receiving side does the checking. The host posts to the exact
pages origin.

### Page → host

| Message | Data | Meaning | Handled in |
|---|---|---|---|
| `ready` | — | "my agent has started": first load, Retry, or after navigating | `modeSync`, `previewSync`, `selectionSync`, `hoverSync`, `layersSync` |
| `hover` | `{id, name, rect, ancestors}` or `null` | element under the pointer (or under a hovered layers row) | `hoverSync` |
| `pick` | `{id or null, shiftKey}` | a click in Select mode (`null` = page background) | `selectionSync` |
| `selection` | `{boxes, missing}` | where the selected elements are, their live values; ids that no longer exist | `selectionSync` |
| `navigated` | `{from, id}` | answer to a keyboard navigation request | `selectionSync` |
| `children` | `{requestId, parentId, children}` | answer to `get-children` | `layersSync` |
| `children-changed` | `{parentId, children}` | the page changed its DOM; a loaded row's children differ | `layersSync` |
| `search-results` | `{query, rows}` | matches and their ancestors (re-sent when the page changes) | `layersSync` |
| `key` | `{key, shiftKey, ctrlKey, …}` | a key pressed while the page had focus | `keyboard.js` |
| `zoom-wheel` | `{deltaY, deltaMode, x, y}` | Ctrl/Cmd + wheel over the page | `Board.jsx` |
| `page-error` | `{message}` | the page's own uncaught error or unhandled rejection | `previewSync` |

### Host → page

| Message | Data | Meaning |
|---|---|---|
| `set-mode` | `{mode}` | Select or Interact |
| `clear-hover` | — | the board started panning or zooming |
| `set-hover` | `{id or null}` | a layers row is hovered |
| `set-selection` | `{ids}` | measure these elements every frame |
| `navigate` | `{id, direction}` | first child / parent / next / previous from this element |
| `scroll-into-view` | `{id}` | scroll this page (only this page) to show the element |
| `get-children` | `{requestId, parentId, delayMs}` | the children of a row (`null` = top level) |
| `search` | `{query, delayMs}` | search the whole page (`""` stops) |

(`delayMs` exists only for the dev menu, to simulate a slow page.)

### When one side is slow, gone, or replaced

**Slow.**
- Layers rows and search: no answer within **3 s** → "Couldn't load" / "Couldn't search" with Retry, reported once. A late answer is ignored (its request is no longer pending).
- A preview: no `ready` within **10 s** → "Couldn't connect to this preview" with Retry, reported once. A late `ready` changes nothing until Retry.
- Details (API): the request is aborted when the selection changes, so a slow answer can never show for the wrong element, and an aborted request is not a failure.
- Keyboard navigation: the answer carries `from`; it is applied only if the selection hasn't changed meanwhile.

**Gone.**
- A preview removed from the board: its connection timer is cleared on unmount; messages from it are ignored (its window is no longer one of our iframes); `failRegion` ignores regions that no longer exist (R6.6).
- An element removed from its page: the agent reports it in `missing` (selection), leaves it out of child lists (layers), and the hover loop stops finding it (hover clears).
- The agent's own registry uses `WeakMap` / `WeakRef`, so removed elements can be garbage-collected.

**Replaced.**
- *The page navigates* (a link followed in Interact mode): the new page's agent says `ready` again. The host sends it the current mode, clears that preview's selection and hover, throws away its layers tree, scroll memory and saved search state, reloads the panel if it's the active preview, and clears its page-error badge. If the new page has no agent, the iframe's `load` event re-arms the 10 s timer, so it fails visibly.
- *The page rebuilds its DOM* (page 4 every 2 s): a `MutationObserver` in the agent notices; rebuilt elements keep their ids by fingerprint; changed child lists and search results are re-sent.
- *The host reloads*: all pages reload with it; nothing is persisted (out of scope).

---

## Element identity across re-renders and navigation

**Ids.** The agent names elements `e1`, `e2`, … with a `WeakMap` (element → id) and
a `Map` of `WeakRef`s (id → element). The same node always keeps its id.

**Re-renders.** When a node is replaced by a new one that "looks the same" (page 4
rebuilds every item with `innerHTML`), the old id must move to the new node. Each
selected element and each loaded layers row has a **fingerprint**, refreshed every
frame (and taken at click time):

- **anchor**: the nearest element with a `data-key`: the element itself, an ancestor, or the nearest keyed sibling before and/or after it;
- **path**: the child-index steps from the anchor down to the element;
- **signatures**: tag + id + classes + `data-key` + `data-name` at every step. Text is deliberately not part of it: text changes ("4s ago") while the element stays the same.

When the node disappears, the fingerprint is resolved in the new DOM and the new
node takes over the old id. **To never jump to a different element**, any doubt
means "no longer exists": a `data-key` that matches 0 or several elements, two
sibling anchors that point to different nodes, or any signature that differs.
Two old rows can't claim the same new node.

Result on page 4: open rows stay open, selected items stay selected as new items
are inserted above them, and an item that drops off the end is removed from the
selection ("This element no longer exists"), even though the new last item has
exactly the same structure.

**Navigation.** A navigated page is a new document with a new agent and fresh ids;
the old ids mean nothing there. So navigation clears that preview's selection and
layers state (R3.8) instead of trying to match across documents.

---

## Failures

**Regions (R6.1):** the board; each preview; the layers panel; each layers row's
child loading; the inspector; the inspector's Details section.

| Failure | Shown where | Reported as |
|---|---|---|
| `GET /screens` 5xx / bad body | the board: "Couldn't load the screens" + Retry | `board` |
| Page doesn't connect within 10 s | that preview only + Retry | `preview` |
| Row children: no answer in 3 s | that row: "Couldn't load" + Retry | `layers-row` (`layers` for the top level) |
| Search: no answer in 3 s | the panel + Retry | `layers` |
| `GET /elements/:key` fails / bad data | Details only; Live values stay | `details` + `elementKey` |
| Render error in a region | that region + Retry | its region |
| Error in a handler, timer, message or response (R6.5) | its region + Retry, the same as a render error | its region |
| Error inside a page | "Page error" badge, message on hover | `preview` |

**Exactly once (R6.4).** Each failure has one place that reports it: the timeout
callback, the request's `catch`, `componentDidCatch`, or `failRegion`. A region
already showing an error does not report again until Retry; a Retry that fails
again is a new failure. Cancelled or replaced requests (`AbortError`, or a request
that is no longer the current one) show nothing and report nothing.

**Anywhere (R6.5).** React error boundaries only catch errors thrown while
rendering. Every other entry point is wrapped: the single message dispatcher in
`bridge.js`, every timer, and every event handler (`inRegion(region, screenId, fn)`),
so a thrown error lands in the same `failRegion()` as a render error.

**Dev menu (R6.7).** Each trigger uses the real failure path: the backend's own
`?fail=` / `?latency=` parameters, a preview pointed at a page that doesn't exist,
a render crash thrown inside the region's boundary, and "the next handler / timer /
message in this region throws" thrown from inside `inRegion()`.

---

## Ambiguous requirements and what I decided

**Board and modes**
1. **"Ctrl/Cmd + wheel zooms wherever the pointer is"**: read as anywhere on the board, including over previews. Over the sidebar or toolbar it keeps the browser's own page zoom.
2. **Keys in Interact mode** while a page has focus and no text field is focused: V / I still switch modes (R3.6 "all shortcuts work"), and the page also receives the key. Keys typed into a text field are never shortcuts.
3. **Escape** clears the selection only in Select mode; in Interact mode the selection is hidden and the page may use Escape itself.
4. **Clicking vs dragging empty board space**: less than 4 px of movement is a click (clears the selection); more is a pan (keeps it).
5. **Errors in board handlers** (wheel, drag, keyboard shortcuts) belong to the board region, so they take the whole board down until Retry.

**Selection**

6. **Shift + click on page background** keeps the selection; a plain click clears it.
7. **Elements that are never drawn** (`script`, `style`, `template`, `noscript`, `link`, `meta`) are not navigable, not layers rows and not search results.
8. **"Top level"** for Shift + Enter = the children of `<body>`.
9. The **hover outline is hidden on an element that is already selected**, to avoid two labels on one element.
10. **Active preview** also changes when you click a page's background in Select mode (it is "the preview the user last clicked").

**Layers**

11. **↑ / ↓ with nothing selected** start at the first row; they don't wrap at the ends.
12. **Tab in the layers panel** with a selection moves the selection to the next sibling (R3.5 / R3.6) rather than moving keyboard focus.
13. **Switching back to a preview by clicking an element in it**: the panel restores that preview exactly (R4.9), then R4.5 opens the new selection's ancestors and scrolls to it if needed. Clicking the page background switches without changing anything.
14. **R4.5 vs R4.11 conflict**: selecting a search result opens its ancestors in the normal tree, but "clearing the search restores exactly the expanded state from before". Restore wins: the open rows are copied when the search starts and put back when it is cleared, so the selected row may be inside a closed parent afterwards.
15. **Search** is a case-insensitive "name contains" match using the brief's naming rule; one search box applies to whichever preview is active.
16. **Late answers after a timeout** (rows, search, preview connection) are ignored until Retry, so an error never silently flips back.

**Inspector**

17. **"Position within the page"** = position in the page's document, including how far the page is scrolled, rounded.
18. **"First 120 characters of text"**: runs of spaces and line breaks become one space first.
19. **Details are fetched per selected element**: selecting a different element with the same key fetches again, so an old error never sticks.
20. The **inspector stays visible in Interact mode** (the selection still exists there, just hidden on the board).

**Failures**

21. **Errors inside a page** are both shown as a badge (R6.3) and reported (region `preview`); the badge clears when the page reloads or navigates.
22. A **region already showing an error** doesn't report further errors until Retry; it's one failure.
23. **Messages from the layers features** fail the layers panel; all other page messages fail the preview they came from.

---

## Where this breaks

**Identity (R3.7 asks to name the cases where the selection could jump)**
- An element with **no `data-key` on itself, an ancestor or a sibling** is anchored on child positions from `<body>`. If one rebuild both replaces it *and* inserts an identical sibling (same tag, classes, id) before it, the selection can move to the wrong element. None of the seven pages do this.
- An element with **a keyed sibling on only one side**, where one rebuild inserts an identical element between that sibling and it: the single anchor can't detect the shift, so the selection can jump.
- Safe but lossy: if a page **changes an element's classes**, or two elements share a `data-key`, the element is treated as gone and deselected.

**Hit-testing and drawing**
- Elements with `pointer-events: none` are skipped by `elementFromPoint`, so they can't be hovered or selected from the preview (they still can from the layers panel).
- Outlines are axis-aligned boxes (`getBoundingClientRect`); rotated or skewed elements get their bounding box, not their shape.
- An element only *partly* inside an inner scroll area gets its full outline, which can extend past the scroll area's edge. Fully scrolled-out elements are handled.
- Shadow DOM and iframes inside the pages are not looked into.

**Performance**
- 24 live iframes are always mounted; nothing is unloaded off-screen.
- While something is selected, its page measures it (including `getComputedStyle`) every animation frame.
- Every DOM change rebuilds every watched child list in that page. Fine for these pages; a page that mutates every frame with many open rows would do noticeable work.
- Search draws every result. Searching `setting` on page 5 draws about 1,400 rows; a much larger page would need a virtualised list.
- Rows removed from a page stay in the host's tree object (unreachable) until the page navigates; a long session on page 4 slowly accumulates them.

**Other**
- Ctrl/Cmd + wheel over the sidebar zooms the browser, not the board.
- A preview that navigates to a page without the agent shows "Couldn't connect to this preview" (by design: nothing can be inspected there).
- The agent's messages use `"*"` as the target origin. If a page were embedded by some other site, that site could read them; they contain no secrets.

---

## With another week

- **Tests.** Unit tests for `layersTree.js`, the fingerprint resolver and the store's selection rules; Playwright end-to-end tests driving the real iframes, including the page-4 re-render cases.
- **Virtualised layers list** for big trees and search results.
- **A `MessageChannel` per preview** instead of window-level `postMessage`: a private port per iframe, no origin checks needed per message, and easier to reason about when a preview is replaced.
- **Less polling.** Use `ResizeObserver` / `IntersectionObserver` and scroll listeners where they are enough, and keep the per-frame loop only as a fallback.
- **Stronger identity.** Use the `MutationObserver` records themselves to follow moved nodes before falling back to fingerprints.
- **Lazy previews.** Mount iframes only near the visible part of the board, with a snapshot image for the rest.
- **Message schemas.** Validate every message shape at the bridge, and version the protocol.
- **TypeScript** for the store, the protocol and the tree.
- **Accessibility.** A roving `tabindex` and full ARIA tree semantics in the layers panel.

---

## Assignment brief

<details>
<summary>The original brief from the starter kit (click to expand)</summary>

# Figr — Frontend Engineer Assignment

Role and brief: [doc.figr.design/frontend-engineer](https://doc.figr.design/frontend-engineer) · Submit: [join.figr.design/r/kdqVkj](https://join.figr.design/r/kdqVkj)

## Setting

You're building the viewer for a design tool. A board shows live previews of web pages. Each preview is an `<iframe>` showing a page served from a **different origin** than your app. Users point at elements inside any preview. Your app, the page that contains the previews (the "host"), draws the outlines and labels on top of each preview. It also shows a layers panel and an inspector for whatever is selected.

Use any framework, language, library, AI tool or workflow you like.

## What's in this kit

```
backend/
  server.js        mock API (:4000) and page server (:4001), no dependencies
  data/            screens.json, elements.json
  pages/           the preview pages
frontend/
  report.js        error reporter stub
```

Run the backend with Node 18+:

```
npm run backend
```

- **Pages** at `http://localhost:4001`: `page-1.html` to `page-6.html`, plus `page-6-next.html`, which page 6 links to. You may add **one `<script>` tag** to each page. You may not change anything else in them.
- **API** at `http://localhost:4000`. Every route accepts `?latency=<ms>&fail=<0..1>`. A failed request returns either a 5xx or a 200 with a malformed body.
  - `GET /screens` returns `[{ id, name, url }]`: 24 screens, which reuse the 6 pages.
  - `GET /elements/:key` returns `{ component, description, status, owner }` for elements that carry a `data-key` attribute. It returns `404` when there are no details for that key.
- **`report(error, context)`** in `frontend/report.js`: a stub error reporter that logs every call.

Build your app in `frontend/`, or anywhere else in the repo.

## Terms

- **Preview**: one iframe on the board.
- **Element**: any element inside a preview's page except `<html>` and `<body>`.
- **Active preview**: the preview the user last clicked in Select mode. The layers panel and inspector show the active preview.
- **Name**: an element's `data-name` if it has one, otherwise tag plus first class (`button.primary`) or tag plus id (`div#hero`), otherwise the tag alone.

## Requirements

### R1: Board

1. Show every screen from `GET /screens` as a preview, 1280×800 each, in a grid, with the screen name above it.
2. Dragging empty board space pans the board. The wheel over empty board space pans too.
3. **Ctrl/Cmd + wheel** zooms the board from 25% to 400%, centred on the pointer. This works **wherever the pointer is, including over a preview**.
4. The wheel over a preview scrolls that page, in both modes.
5. Two modes, switched from a toolbar toggle and the **V** key (Select) and **I** key (Interact):
   - **Select mode** (default): clicks select elements and never reach the page. Links don't navigate, buttons don't act, inputs don't get focus, forms don't submit.
   - **Interact mode**: the page behaves normally and no outlines are drawn.
     - The selection is kept but hidden, and it reappears when switching back to Select mode if the elements still exist.
     - The layers panel keeps updating as the page changes.

### R2: Hover (Select mode)

1. When the pointer is over an element, draw a **1px outline** exactly on that element's box, with a label showing its name.
2. Only one element on the whole board is hovered at a time.
3. Hover clears when the pointer leaves the preview or the window, or when the board starts panning or zooming.
4. **Every** element can be hovered and selected, including disabled buttons and inputs, images, SVG, and elements under a sticky header.
5. Page background (`<html>` / `<body>`) is never hovered. Pointing at it shows nothing.

### R3: Selection

1. Clicking selects the element under the pointer. Selected elements get a **2px outline** in a different colour from hover, plus a label.
2. **Shift + click** adds or removes an element in the same preview. Shift + click in a different preview replaces the selection with that element.
3. **Escape**, clicking page background, or clicking empty board space clears the selection.
4. Outlines and labels:
   - stay glued to their element while the user pans, zooms, scrolls inside the page (including scroll areas inside the page), resizes the window, or the element changes size or moves;
   - stay 1px or 2px thick and keep the same label size at every zoom level;
   - are clipped to the preview's edges. An element scrolled fully out of view has no outline but stays selected;
   - put the label below the element when there's no room above it inside the preview.
5. **Keyboard.** When several elements are selected, each of these keys acts on the most recently selected one and replaces the selection with the result.
   - **Enter** selects the first child.
   - **Shift + Enter** selects the parent. Nothing happens at the top level.
   - **Tab / Shift + Tab** selects the next or previous sibling, wrapping around.
6. **All shortcuts** (V, I, Escape, Enter, Tab, and so on) work even right after the user clicked inside a preview.
7. **The page re-renders itself:**
   - A selected element that still exists stays selected, even if the page rebuilt its DOM nodes or inserted new siblings before it.
   - A selected element that no longer exists is removed from the selection. If nothing remains selected, the inspector says **"This element no longer exists"** until the next selection.
   - The selection must never jump to a different element. If your approach can't guarantee this in some case, say which case in your README.
8. **A page navigates** (a link followed in Interact mode):
   - That preview's selection clears.
   - Select mode works on the new page with no reload of the board.
   - The layers panel shows the new page.

### R4: Layers panel

1. It shows the element tree of the active preview. With no active preview, it shows "Click something in a preview".
2. Each row shows indentation, the element's name, and a chevron if the element has children. Top-level rows are the children of `<body>`.
3. **Children load when a row is first expanded.** While loading, the row shows a loading state. If the page doesn't answer within 3 seconds, the row shows "Couldn't load" with a retry on that row only.
   - Collapsing and re-expanding a row, including while it's still loading, must never produce duplicate or missing children.
4. **Hover sync, both directions:**
   - Hovering a row draws the hover outline on that element in the preview.
   - Hovering an element in the preview highlights its row. If that row is inside a collapsed parent, highlight the nearest visible ancestor row instead. Hover never expands anything.
5. **Selection sync, both directions:**
   - Clicking a row selects that element.
   - Selecting an element in the preview expands every ancestor of its row (loading them if needed, even many levels deep), highlights the row, and scrolls the panel to show it.
6. Clicking a row whose element is out of view inside the page scrolls **only that page** to show the element. The board and the host page don't move.
7. **Multi-select:** Shift + click on a row adds or removes it, and all selected rows are highlighted.
8. **Keyboard while the panel has focus:**
   - **↑ / ↓** select the previous or next visible row.
   - **→** expands a row, or moves to its first child if it's already expanded.
   - **←** collapses a row, or moves to its parent if it's already collapsed.
9. **Expanded rows and panel scroll position are remembered per preview.** Switching the active preview to B and back to A restores A exactly as it was left, until A's page navigates or the board reloads.
10. **When the page changes its own DOM, the tree updates to match:**
    - Rows that still exist keep their expanded state and selection.
    - Removed rows disappear, and a removed hovered row clears the hover.
    - Rows the user is looking at don't jump. The scroll position holds steady.
11. **Search box:**
    - Typing shows only rows whose name contains the text, together with their ancestors.
    - Search covers the whole tree, including rows never loaded.
    - Clearing the search restores exactly the expanded state from before the search.
    - Selecting a search result selects the element and keeps the search open.

### R5: Inspector

1. With **one** element selected, it has two sections:
   - **Live** (read from the page): name, tag, id, classes, width × height (px, rounded), position within the page, the first 120 characters of text, text colour, background colour, font family, size and weight. Values update when the element changes.
   - **Details** (from `GET /elements/:key`): component, description, status, owner.
     - An element with no `data-key` shows "No details".
     - A `404` shows "No details for this element". A 404 is not an error.
2. With **several** elements selected, it shows "N elements", and each Live field shows either the value they all share or "Mixed". There is no Details section.
3. When the selection changes while Details are loading, only the latest selection's details are ever shown.

### R6: Failures

1. **Regions.** Each of these is its own region: the board, each preview, the layers panel, each row's child loading, and the inspector's Details section.
2. **A failure in a region shows an error with a Retry button in that region only.** Everything else keeps working.
   - `GET /screens` fails → the board shows the error.
   - A preview's page doesn't load, or its script doesn't respond within 10 seconds → "Couldn't connect to this preview" on that preview only.
   - `GET /elements/:key` fails or returns bad data → error in Details only. Live values still show.
   - A render error in the inspector → the inspector shows the error. The board and the layers panel keep working.
3. **Errors inside a page** are shown as a small "Page error" badge on that preview. Hovering the badge shows the message.
4. **Reporting:**
   - Every failure reaches `report()` **exactly once**, with `{ region, screenId, elementKey? }`.
   - A retry that fails again counts as a new failure.
   - A request that was cancelled or replaced because the user moved on is **not** a failure: no error is shown and nothing is reported.
5. **Where an error happens doesn't matter.** An error thrown while drawing, handling a click or key, handling a message from a preview, in a timer, or when a response arrives gets the same region error and the same single report.
6. **A response or error that arrives after its region is gone** changes nothing and reports nothing.
7. **A dev-only menu** can trigger each of these failures on demand, for the video.

### Out of scope

Editing pages, saving anything across a reload, auth, mobile, and more than one user.

## Deliverables

1. **A public GitHub repo** that runs the backend and your app with one command.
2. **A README** covering:
   - any requirement you found ambiguous or contradictory, and what you decided;
   - how state is organised: what lives where, and who is allowed to change it;
   - how the host and the pages talk to each other: the messages, and what happens when one side is slow, gone, or replaced;
   - **"where this breaks"**: the cases you know your build gets wrong.
3. **A 15-minute video** (Loom or any shareable link) explaining your code. We evaluate your system design calls mainly from this video, so talk through the *why*, not just the *what*.
   - **2 min**: what you built and the main calls you made.
   - **8 min**: walk through the code behind R1–R6, showing each part running. Cover your state model, the host ↔ page protocol, how you identify elements across re-renders and navigation, how the tree loads, and how failures are contained and reported.
   - **3 min**: where it breaks, and what you'd change with another week.
   - **2 min**: how you used AI, and where it got things wrong.

You may study any public product, Figr included. If you do, say what you took and why it works.

## Submitting

Submit your repo, video and resume here: **https://join.figr.design/r/kdqVkj**

</details>
