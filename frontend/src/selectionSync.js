import { useStore } from "./store.js";
import { onAgentMessage, sendToPreview, findIframeByScreenId } from "./bridge.js";

// The store decides what is selected; pages only report clicks and positions.

// Keyboard navigation from the most recently selected element.
// Returns false when nothing is selected, so the key keeps its normal job.
export function navigateSelection(direction) {
  const { mode, selection } = useStore.getState();
  if (mode !== "select" || selection.ids.length === 0) return false;

  const iframe = findIframeByScreenId(selection.screenId);
  if (!iframe) return false;

  const mostRecent = selection.ids[selection.ids.length - 1];
  sendToPreview(iframe, "navigate", { id: mostRecent, direction });
  return true;
}

export function startSelectionSync() {
  onAgentMessage("navigated", (data, iframe) => {
    if (data.id === null) return;

    // Ignore the answer if the selection changed while we waited.
    const { selection, selectOnly } = useStore.getState();
    const screenId = iframe.dataset.screenId;
    const mostRecent = selection.ids[selection.ids.length - 1];
    if (selection.screenId !== screenId || mostRecent !== data.from) return;

    selectOnly(screenId, data.id);
  });

  onAgentMessage("pick", (data, iframe) => {
    if (useStore.getState().mode !== "select") return;
    useStore.getState().pickElement(iframe.dataset.screenId, data.id, data.shiftKey);
  });

  onAgentMessage("selection", (data, iframe) => {
    useStore.getState().setSelectionBoxes(iframe.dataset.screenId, data.boxes, data.missing);
  });

  // A navigated page has new elements, so its old selection is cleared.
  onAgentMessage("ready", (_data, iframe) => {
    if (useStore.getState().selection.screenId === iframe.dataset.screenId) {
      useStore.getState().clearSelection();
    }
  });

  // Tell the page(s) involved which ids to keep measuring.
  useStore.subscribe((state, previous) => {
    if (state.selection === previous.selection) return;

    const { screenId, ids } = state.selection;
    const before = previous.selection.screenId;

    if (before && before !== screenId) {
      const oldIframe = findIframeByScreenId(before);
      if (oldIframe) sendToPreview(oldIframe, "set-selection", { ids: [] });
    }
    if (screenId) {
      const iframe = findIframeByScreenId(screenId);
      if (iframe) sendToPreview(iframe, "set-selection", { ids });
    }
  });
}
