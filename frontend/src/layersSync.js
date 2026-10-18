import { useStore } from "./store.js";
import { onAgentMessage, sendToPreview, findIframeByScreenId } from "./bridge.js";
import { ROOT, setStatus, setChildren, setExpanded, visibleRows, parentRowOf } from "./layersTree.js";
import { report } from "../report.js";

// Layers panel loading (R4.1-R4.3).
//
//   Host -> page:  "get-children" { requestId, parentId }   parentId null = top level
//   Page -> host:  "children"     { requestId, parentId, children: [{ id, name, key, hasChildren }] }
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
  const timer = setTimeout(() => onTimeout(requestId), TIMEOUT_MS);
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
  const { layers, selection } = useStore.getState();
  const tree = layers[screenId];
  const rows = visibleRows(tree);
  if (rows.length === 0) return;

  const currentId = selection.screenId === screenId ? selection.ids[selection.ids.length - 1] : null;
  const index = rows.findIndex((row) => row.id === currentId); // -1 if no current row
  const select = (id) => clickRow(screenId, id, false); // same as clicking that row

  if (key === "ArrowDown") return select(rows[index === -1 ? 0 : Math.min(index + 1, rows.length - 1)].id);
  if (key === "ArrowUp") return select(rows[index === -1 ? 0 : Math.max(index - 1, 0)].id);
  if (index === -1) return; // → and ← need a current row

  const row = rows[index];
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
}

// Make sure the active preview's top level is loaded (R4.1).
function showActivePreview() {
  const { activeScreenId, layers } = useStore.getState();
  if (activeScreenId && !layers[activeScreenId]) loadChildren(activeScreenId, ROOT);
}

export function startLayersSync() {
  onAgentMessage("children", (data, iframe) => {
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

  // The page (re)started: if it navigated, its old tree is gone (R3.8).
  // The active preview reloads its top level, so the panel shows the new page.
  onAgentMessage("ready", (_data, iframe) => {
    const screenId = iframe.dataset.screenId;
    if (!useStore.getState().layers[screenId]) return; // never loaded: nothing to forget
    forgetScreen(screenId);
    showActivePreview();
  });

  // A new active preview: load its tree the first time it is shown.
  useStore.subscribe((state, previous) => {
    if (state.activeScreenId !== previous.activeScreenId) showActivePreview();
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
