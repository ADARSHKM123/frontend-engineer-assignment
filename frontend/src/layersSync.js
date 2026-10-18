import { useStore } from "./store.js";
import { onAgentMessage, sendToPreview, findIframeByScreenId } from "./bridge.js";
import { ROOT, setStatus, setChildren, setExpanded } from "./layersTree.js";
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
}
