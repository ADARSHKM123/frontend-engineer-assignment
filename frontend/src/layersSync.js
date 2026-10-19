import { useStore } from "./store.js";
import { onAgentMessage, sendToPreview, findIframeByScreenId } from "./bridge.js";
import { ROOT, setStatus, setChildren, setExpanded, visibleRows, parentRowOf } from "./layersTree.js";
import { report } from "../report.js";
import { inRegion } from "./regions.js";

// Messages handled here belong to the layers panel: if a handler throws, the
// panel shows the error (R6.5).
const onLayersMessage = (type, handler) => onAgentMessage(type, handler, "layers");

// Layers panel loading (R4.1-R4.3).
//
//   Host -> page:  "get-children" { requestId, parentId }   parentId null = top level
//   Page -> host:  "children"     { requestId, parentId, children: [{ id, name, key, hasChildren }] }
//   Page -> host:  "children-changed" { parentId, children }   the page changed its DOM (R4.10)
//
// Every request gets a number and a 3-second timer. Whichever comes first wins:
//   - the answer arrives: the children are stored, the timer is cancelled
//   - the timer fires:    the row shows "Couldn't load" + Retry, and report() is called once
// An answer that arrives after its timer fired, or after the page navigated, is
// no longer in `pending`, so it is ignored (R6.6).

const TIMEOUT_MS = 3000;

let nextRequestId = 1;
const pending = new Map(); // requestId -> { screenId, parentId, timer }

// Load the children of one row (or of ROOT, the top level).
export function loadChildren(screenId, parentId) {
  const { updateLayers, dev } = useStore.getState();
  updateLayers(screenId, (tree) => setStatus(tree, parentId, "loading"));

  const requestId = nextRequestId++;
  // inRegion: an error inside the timer fails the layers panel instead of being lost (R6.5).
  const timer = setTimeout(inRegion("layers", screenId, () => onTimeout(requestId)), TIMEOUT_MS);
  pending.set(requestId, { screenId, parentId, timer });

  // If the iframe is missing, nothing is sent and the timer reports the failure.
  const iframe = findIframeByScreenId(screenId);
  if (iframe) {
    sendToPreview(iframe, "get-children", {
      requestId,
      parentId: parentId === ROOT ? null : parentId,
      delayMs: dev.layersDelayMs,
    });
  }
}

function onTimeout(requestId) {
  const request = pending.get(requestId);
  if (!request) return;
  pending.delete(requestId);
  fail(request, new Error("The page didn't answer within 3 seconds"));
}

// A row's children couldn't be loaded: show the error on that row and report it once.
function fail(request, error) {
  const { screenId, parentId } = request;
  const { updateLayers, layers } = useStore.getState();
  updateLayers(screenId, (tree) => setStatus(tree, parentId, "error"));

  // The top level failing is the whole panel's region; any other row is its own region (R6.1).
  const elementKey = layers[screenId]?.nodes[parentId]?.key || undefined;
  report(error, {
    region: parentId === ROOT ? "layers" : "layers-row",
    screenId,
    elementKey,
  });
}

// Expand or collapse a row. The first expand loads its children (R4.3).
// Collapsing while loading only hides the row: the request carries on, and its
// answer fills the children once. So re-expanding never loads twice.
export function toggleRow(screenId, id) {
  const { layers, updateLayers } = useStore.getState();
  const tree = layers[screenId];
  const node = tree.nodes[id];
  const willExpand = !tree.expanded[id];

  updateLayers(screenId, (t) => setExpanded(t, id, willExpand));
  if (willExpand && node.childIds === null && node.status !== "loading") {
    loadChildren(screenId, id);
  }
}

// Click on a row: select its element, exactly like clicking it in the preview
// (Shift + click adds or removes, R4.7). Then scroll ONLY that page so the
// element is in view (R4.6); the board doesn't move.
export function clickRow(screenId, id, shiftKey) {
  const { pickElement } = useStore.getState();
  pickElement(screenId, id, shiftKey);

  const isSelected = useStore.getState().selection.ids.includes(id); // false if Shift removed it
  const iframe = findIframeByScreenId(screenId);
  if (isSelected && iframe) sendToPreview(iframe, "scroll-into-view", { id });
}

// Open every ancestor row of an element (R4.5), loading the ones never loaded.
// We know all the ancestor ids at once (the page sends them), so every missing
// level is requested in parallel, even 30 levels deep (page 5).
function revealRow(screenId, ancestors) {
  for (const id of ancestors) {
    const { layers, updateLayers } = useStore.getState();
    const node = layers[screenId]?.nodes[id];
    updateLayers(screenId, (tree) => setExpanded(tree, id, true));
    if (!node?.childIds && node?.status !== "loading") loadChildren(screenId, id);
  }
}

// Arrow keys while the layers panel has focus (R4.8). They act on the current
// row: the row of the most recently selected element.
//   ↓ / ↑  select the next / previous visible row
//   →      closed row: open it.   open row: select its first child
//   ←      open row: close it.    closed row (or no children): select its parent
export function panelArrowKey(screenId, key) {
  const { layers, selection, layersSearch } = useStore.getState();
  const tree = layers[screenId];
  const rows = rowsShown(screenId);
  if (rows.length === 0) return;

  const currentId = selection.screenId === screenId ? selection.ids[selection.ids.length - 1] : null;
  const index = rows.findIndex((row) => row.id === currentId); // -1 if no current row
  const select = (id) => clickRow(screenId, id, false); // same as clicking that row

  if (key === "ArrowDown") return select(rows[index === -1 ? 0 : Math.min(index + 1, rows.length - 1)].id);
  if (key === "ArrowUp") return select(rows[index === -1 ? 0 : Math.max(index - 1, 0)].id);
  if (index === -1) return; // → and ← need a current row

  const row = rows[index];

  // Search results are always fully open, so → and ← only move: to the first
  // child row, or to the parent row.
  if (layersSearch) {
    const next = rows[index + 1];
    if (key === "ArrowRight" && next && next.depth === row.depth + 1) select(next.id);
    if (key === "ArrowLeft") {
      const parent = parentRowOf(rows, index);
      if (parent) select(parent.id);
    }
    return;
  }

  const node = tree.nodes[row.id];
  const isOpen = Boolean(tree.expanded[row.id]);

  if (key === "ArrowRight" && node.hasChildren) {
    if (!isOpen) return toggleRow(screenId, row.id);
    // Already open: its first child is the next row, one level deeper (if loaded yet).
    const next = rows[index + 1];
    if (next && next.depth === row.depth + 1) select(next.id);
  }

  if (key === "ArrowLeft") {
    if (node.hasChildren && isOpen) return toggleRow(screenId, row.id);
    const parent = parentRowOf(rows, index);
    if (parent) select(parent.id); // top-level rows have no parent row: nothing happens
  }
}

// ---- Search (R4.11) ----
//   Host -> page:  "search"         { query }          "" stops searching
//   Page -> host:  "search-results" { query, rows }    matches + their ancestors, in page order
// The page searches its whole DOM, so rows never loaded are found too.
// The page re-sends results when its DOM changes, so they stay correct (R4.10).

const searchTimers = new Map(); // screenId -> timer for "no answer within 3 seconds"
const expandedBeforeSearch = new Map(); // screenId -> that tree's `expanded`, copied when search started

// The search box changed.
export function setSearchQuery(query) {
  const { layersSearch, activeScreenId, setLayersSearch } = useStore.getState();
  setLayersSearch(query);

  if (query) {
    if (activeScreenId) runSearch(activeScreenId);
    return;
  }
  if (layersSearch) stopSearch();
}

function runSearch(screenId) {
  const { layers, searchResults, setSearchResults, layersSearch: query, dev } = useStore.getState();

  // Copy the open rows once, the first time this preview is searched. Selecting a
  // result opens its ancestors in the normal tree (R4.5); clearing puts this copy back.
  if (!expandedBeforeSearch.has(screenId) && layers[screenId]) {
    expandedBeforeSearch.set(screenId, layers[screenId].expanded);
  }

  // Keep showing the previous results while the new ones load (no flicker while typing).
  setSearchResults(screenId, { query, status: "loading", rows: searchResults[screenId]?.rows ?? [] });

  clearTimeout(searchTimers.get(screenId));
  searchTimers.set(
    screenId,
    setTimeout(
      inRegion("layers", screenId, () => {
        searchTimers.delete(screenId);
        const current = useStore.getState().searchResults[screenId];
        if (current?.query !== query || current.status !== "loading") return;
        setSearchResults(screenId, { query, status: "error", rows: [] });
        report(new Error("The page didn't answer the search within 3 seconds"), { region: "layers", screenId });
      }),
      TIMEOUT_MS,
    ),
  );

  const iframe = findIframeByScreenId(screenId);
  if (iframe) sendToPreview(iframe, "search", { query, delayMs: dev.layersDelayMs });
}

// The search box was cleared: stop every page searching, drop the results, and
// put back exactly the open rows each searched preview had before (R4.11).
function stopSearch() {
  const { updateLayers, clearSearchResults } = useStore.getState();
  for (const [screenId, expanded] of expandedBeforeSearch) {
    updateLayers(screenId, (tree) => ({ ...tree, expanded }));
    const iframe = findIframeByScreenId(screenId);
    if (iframe) sendToPreview(iframe, "search", { query: "" });
  }
  for (const timer of searchTimers.values()) clearTimeout(timer);
  searchTimers.clear();
  expandedBeforeSearch.clear();
  clearSearchResults();
}

// Retry button after a search error.
export function retrySearch(screenId) {
  runSearch(screenId);
}

function onSearchResults(data, iframe) {
  const screenId = iframe.dataset.screenId;
  const { layersSearch, searchResults, setSearchResults } = useStore.getState();
  if (!layersSearch || data.query !== layersSearch) return; // an answer for an old query: ignore
  // This search already timed out: its late answer changes nothing (R6.6), until Retry.
  // (Updates while results are showing are fine: they come from the page changing, R4.10.)
  if (searchResults[screenId]?.status === "error") return;
  if (!Array.isArray(data.rows)) return;

  clearTimeout(searchTimers.get(screenId));
  searchTimers.delete(screenId);

  // Work out each row's depth from its parent (parents always come first).
  const depthOf = new Map();
  const rows = data.rows.map((row) => {
    const depth = row.parentId === null ? 0 : (depthOf.get(row.parentId) ?? -1) + 1;
    depthOf.set(row.id, depth);
    return { ...row, depth };
  });
  setSearchResults(screenId, { query: data.query, status: "ready", rows });
}

// The rows the panel is showing right now: search results while searching,
// otherwise the normal tree. Arrow keys move through these (R4.8).
function rowsShown(screenId) {
  const { layersSearch, searchResults, layers } = useStore.getState();
  if (layersSearch) return searchResults[screenId]?.rows ?? [];
  return visibleRows(layers[screenId]);
}

// The panel's scroll position, per preview (R4.9). Kept here rather than in the
// store because nothing is drawn from it: it is only read back when a preview
// becomes active again, and saving it on every scroll event shouldn't re-render.
const scrollTops = new Map(); // screenId -> scrollTop

export function saveLayersScroll(screenId, scrollTop) {
  scrollTops.set(screenId, scrollTop);
}

export function savedLayersScroll(screenId) {
  return scrollTops.get(screenId) ?? 0;
}

// Forget everything about a preview's tree: its rows and its unanswered requests.
// Used when the page navigates; late answers for it are then ignored.
function forgetScreen(screenId) {
  for (const [requestId, request] of pending) {
    if (request.screenId === screenId) {
      clearTimeout(request.timer);
      pending.delete(requestId);
    }
  }
  useStore.getState().resetLayers(screenId);
  scrollTops.delete(screenId); // "until A's page navigates" (R4.9)
  expandedBeforeSearch.delete(screenId); // the old page's open rows mean nothing now
}

// Searching while the active preview changes or navigates: search it too.
function searchActivePreview() {
  const { layersSearch, activeScreenId } = useStore.getState();
  if (layersSearch && activeScreenId) runSearch(activeScreenId);
}

// Make sure the active preview's top level is loaded (R4.1).
function showActivePreview() {
  const { activeScreenId, layers } = useStore.getState();
  if (activeScreenId && !layers[activeScreenId]) loadChildren(activeScreenId, ROOT);
}

export function startLayersSync() {
  onLayersMessage("children", (data, iframe) => {
    const request = pending.get(data.requestId);
    if (!request || request.screenId !== iframe.dataset.screenId) return; // timed out or forgotten

    clearTimeout(request.timer);
    pending.delete(data.requestId);

    // Bad data from the page is treated like no answer: same error, same single report.
    if (!Array.isArray(data.children)) {
      fail(request, new Error("The page sent an invalid list of children"));
      return;
    }
    useStore.getState().updateLayers(request.screenId, (tree) =>
      setChildren(tree, request.parentId, data.children),
    );
  });

  // The page changed its own DOM (R4.10): a loaded row's children are different now.
  // The new list replaces the old one. Rows keep their ids (the page made sure of
  // that), so open rows stay open and selected rows stay selected; removed rows
  // simply aren't in the list any more.
  onLayersMessage("children-changed", (data, iframe) => {
    const screenId = iframe.dataset.screenId;
    const parentId = data.parentId ?? ROOT;
    const tree = useStore.getState().layers[screenId];
    if (!tree?.nodes[parentId]?.childIds) return; // not loaded here (yet): nothing to update
    if (!Array.isArray(data.children)) return;

    // This row's children are now known, so a request still waiting for them is not needed.
    for (const [requestId, request] of pending) {
      if (request.screenId === screenId && request.parentId === parentId) {
        clearTimeout(request.timer);
        pending.delete(requestId);
      }
    }
    useStore.getState().updateLayers(screenId, (t) => setChildren(t, parentId, data.children));
  });

  // The page (re)started: if it navigated, its old tree is gone (R3.8).
  // The active preview reloads its top level, so the panel shows the new page.
  onLayersMessage("ready", (_data, iframe) => {
    const screenId = iframe.dataset.screenId;
    if (!useStore.getState().layers[screenId]) return; // never loaded: nothing to forget
    forgetScreen(screenId);
    showActivePreview();
    if (screenId === useStore.getState().activeScreenId) searchActivePreview(); // the new page needs the query
  });

  onLayersMessage("search-results", onSearchResults);

  // A new active preview: load its tree the first time it is shown (and search it, if searching).
  useStore.subscribe((state, previous) => {
    if (state.activeScreenId === previous.activeScreenId) return;
    showActivePreview();
    searchActivePreview();
  });

  // A newly selected element: open its ancestor rows once (R4.5). Its ancestor
  // ids arrive with its box from the page. "Once" matters: boxes are re-sent
  // whenever the element moves, and we must not re-open rows the user closed.
  let revealed = null; // "screenId/id" of the last element we opened rows for
  useStore.subscribe((state) => {
    const { screenId, ids } = state.selection;
    const mostRecent = ids[ids.length - 1];
    if (!mostRecent) {
      revealed = null;
      return;
    }
    const box = state.selectionBoxes.find((b) => b.id === mostRecent);
    if (!box || revealed === `${screenId}/${mostRecent}`) return;
    revealed = `${screenId}/${mostRecent}`;
    revealRow(screenId, box.ancestors ?? []);
  });
}
