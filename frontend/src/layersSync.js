import { useStore } from "./store.js";
import { onAgentMessage, sendToPreview, findIframeByScreenId } from "./bridge.js";
import { ROOT, setStatus, setChildren, setExpanded, visibleRows, parentRowOf } from "./layersTree.js";
import { report } from "../report.js";
import { inRegion } from "./regions.js";

// If one of these handlers throws, the layers panel shows the error.
const onLayersMessage = (type, handler) => onAgentMessage(type, handler, "layers");

// Each request races a 3 s timer. An answer that arrives after the timer fired,
// or after the page navigated, is no longer in `pending`, so it is ignored.
const TIMEOUT_MS = 3000;

let nextRequestId = 1;
const pending = new Map(); // requestId -> { screenId, parentId, timer }

export function loadChildren(screenId, parentId) {
  const { updateLayers, dev } = useStore.getState();
  updateLayers(screenId, (tree) => setStatus(tree, parentId, "loading"));

  const requestId = nextRequestId++;
  const timer = setTimeout(inRegion("layers", screenId, () => onTimeout(requestId)), TIMEOUT_MS);
  pending.set(requestId, { screenId, parentId, timer });

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

function fail(request, error) {
  const { screenId, parentId } = request;
  const { updateLayers, layers } = useStore.getState();
  updateLayers(screenId, (tree) => setStatus(tree, parentId, "error"));

  // The top level is the panel's region; every other row is its own.
  const elementKey = layers[screenId]?.nodes[parentId]?.key || undefined;
  report(error, {
    region: parentId === ROOT ? "layers" : "layers-row",
    screenId,
    elementKey,
  });
}

// Only the first open loads; collapsing mid-load just hides the row, so its
// single request still fills the children once.
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

// Selects like a click in the preview, then scrolls only that page to the element.
export function clickRow(screenId, id, shiftKey) {
  const { pickElement } = useStore.getState();
  pickElement(screenId, id, shiftKey);

  const isSelected = useStore.getState().selection.ids.includes(id);
  const iframe = findIframeByScreenId(screenId);
  if (isSelected && iframe) sendToPreview(iframe, "scroll-into-view", { id });
}

// Open every ancestor of an element. All ancestor ids are known at once,
// so every missing level is requested in parallel.
function revealRow(screenId, ancestors) {
  for (const id of ancestors) {
    const { layers, updateLayers } = useStore.getState();
    const node = layers[screenId]?.nodes[id];
    updateLayers(screenId, (tree) => setExpanded(tree, id, true));
    if (!node?.childIds && node?.status !== "loading") loadChildren(screenId, id);
  }
}

// Arrow keys in the panel, acting on the most recently selected row.
export function panelArrowKey(screenId, key) {
  const { layers, selection, layersSearch } = useStore.getState();
  const tree = layers[screenId];
  const rows = rowsShown(screenId);
  if (rows.length === 0) return;

  const currentId = selection.screenId === screenId ? selection.ids[selection.ids.length - 1] : null;
  const index = rows.findIndex((row) => row.id === currentId);
  const select = (id) => clickRow(screenId, id, false);

  if (key === "ArrowDown") return select(rows[index === -1 ? 0 : Math.min(index + 1, rows.length - 1)].id);
  if (key === "ArrowUp") return select(rows[index === -1 ? 0 : Math.max(index - 1, 0)].id);
  if (index === -1) return;

  const row = rows[index];

  // Search results are always fully open, so → and ← only move to a child or parent.
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
    const next = rows[index + 1];
    if (next && next.depth === row.depth + 1) select(next.id);
  }

  if (key === "ArrowLeft") {
    if (node.hasChildren && isOpen) return toggleRow(screenId, row.id);
    const parent = parentRowOf(rows, index);
    if (parent) select(parent.id);
  }
}

// ---- Search ----
// The page searches its whole DOM, so rows never loaded are found too.

const searchTimers = new Map();
// The open rows when the search started. Selecting a result opens rows in the
// normal tree; clearing the search puts this copy back exactly.
const expandedBeforeSearch = new Map();

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

  if (!expandedBeforeSearch.has(screenId) && layers[screenId]) {
    expandedBeforeSearch.set(screenId, layers[screenId].expanded);
  }

  // Keep the previous results visible while the new ones load, so typing doesn't flicker.
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

export function retrySearch(screenId) {
  runSearch(screenId);
}

function onSearchResults(data, iframe) {
  const screenId = iframe.dataset.screenId;
  const { layersSearch, searchResults, setSearchResults } = useStore.getState();
  if (!layersSearch || data.query !== layersSearch) return;
  // A timed-out search ignores its late answer until Retry.
  if (searchResults[screenId]?.status === "error") return;
  if (!Array.isArray(data.rows)) return;

  clearTimeout(searchTimers.get(screenId));
  searchTimers.delete(screenId);

  // Parents always come before their children, so depth can be worked out in one pass.
  const depthOf = new Map();
  const rows = data.rows.map((row) => {
    const depth = row.parentId === null ? 0 : (depthOf.get(row.parentId) ?? -1) + 1;
    depthOf.set(row.id, depth);
    return { ...row, depth };
  });
  setSearchResults(screenId, { query: data.query, status: "ready", rows });
}

function rowsShown(screenId) {
  const { layersSearch, searchResults, layers } = useStore.getState();
  if (layersSearch) return searchResults[screenId]?.rows ?? [];
  return visibleRows(layers[screenId]);
}

// Per-preview scroll position. Not in the store: nothing is drawn from it,
// and saving it on every scroll event shouldn't re-render.
const scrollTops = new Map();

export function saveLayersScroll(screenId, scrollTop) {
  scrollTops.set(screenId, scrollTop);
}

export function savedLayersScroll(screenId) {
  return scrollTops.get(screenId) ?? 0;
}

// The page navigated: forget its tree, its pending requests and its memory.
function forgetScreen(screenId) {
  for (const [requestId, request] of pending) {
    if (request.screenId === screenId) {
      clearTimeout(request.timer);
      pending.delete(requestId);
    }
  }
  useStore.getState().resetLayers(screenId);
  scrollTops.delete(screenId);
  expandedBeforeSearch.delete(screenId);
}

function searchActivePreview() {
  const { layersSearch, activeScreenId } = useStore.getState();
  if (layersSearch && activeScreenId) runSearch(activeScreenId);
}

function showActivePreview() {
  const { activeScreenId, layers } = useStore.getState();
  if (activeScreenId && !layers[activeScreenId]) loadChildren(activeScreenId, ROOT);
}

export function startLayersSync() {
  onLayersMessage("children", (data, iframe) => {
    const request = pending.get(data.requestId);
    if (!request || request.screenId !== iframe.dataset.screenId) return;

    clearTimeout(request.timer);
    pending.delete(data.requestId);

    if (!Array.isArray(data.children)) {
      fail(request, new Error("The page sent an invalid list of children"));
      return;
    }
    useStore.getState().updateLayers(request.screenId, (tree) =>
      setChildren(tree, request.parentId, data.children),
    );
  });

  // The page changed its DOM. Rows keep their ids, so open and selected
  // rows stay that way; removed rows are simply not in the new list.
  onLayersMessage("children-changed", (data, iframe) => {
    const screenId = iframe.dataset.screenId;
    const parentId = data.parentId ?? ROOT;
    const tree = useStore.getState().layers[screenId];
    if (!tree?.nodes[parentId]?.childIds) return;
    if (!Array.isArray(data.children)) return;

    for (const [requestId, request] of pending) {
      if (request.screenId === screenId && request.parentId === parentId) {
        clearTimeout(request.timer);
        pending.delete(requestId);
      }
    }
    useStore.getState().updateLayers(screenId, (t) => setChildren(t, parentId, data.children));
  });

  // A navigated page starts with a fresh tree.
  onLayersMessage("ready", (_data, iframe) => {
    const screenId = iframe.dataset.screenId;
    if (!useStore.getState().layers[screenId]) return;
    forgetScreen(screenId);
    showActivePreview();
    if (screenId === useStore.getState().activeScreenId) searchActivePreview();
  });

  onLayersMessage("search-results", onSearchResults);

  useStore.subscribe((state, previous) => {
    if (state.activeScreenId === previous.activeScreenId) return;
    showActivePreview();
    searchActivePreview();
  });

  // Reveal a newly selected element's row once. Boxes are re-sent whenever
  // the element moves, and rows the user closed afterwards must stay closed.
  let revealed = null;
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
