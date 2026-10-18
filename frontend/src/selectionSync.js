import { useStore } from "./store.js";
import { onAgentMessage, sendToPreview, findIframeByScreenId } from "./bridge.js";

// Selection (R3). The store decides what is selected; the pages only report.
//
//   Page -> host:  "pick"       { id, shiftKey }    a click in Select mode (id null = background)
//   Page -> host:  "selection"  { boxes, missing }  where the selected elements are now,
//                                                    and which ones no longer exist (R3.7)
//   Host -> page:  "set-selection" { ids }          which elements the page should keep measuring
//   Host -> page:  "navigate"   { id, direction }   keyboard navigation from this element (R3.5)
//   Page -> host:  "navigated"  { from, id }        the element found there (id null = nothing)

// Ask the page to move the selection with the keyboard (R3.5).
// Acts on the most recently selected element: the last id in the list.
// Returns false when there's nothing to navigate from, so the key keeps its normal job.
export function navigateSelection(direction) {
  const { mode, selection } = useStore.getState();
  console.log('navigateSelection', selection)
  if (mode !== "select" || selection.ids.length === 0) return false;

  const iframe = findIframeByScreenId(selection.screenId);
  if (!iframe) return false;

  const mostRecent = selection.ids[selection.ids.length - 1];
  console.log(iframe, "navigate", { id: mostRecent, direction })
  sendToPreview(iframe, "navigate", { id: mostRecent, direction });
  return true;
}

export function startSelectionSync() {
  onAgentMessage("navigated", (data, iframe) => {
    if (data.id === null) return; // no child / top level: "nothing happens"

    // Only apply the answer if the selection hasn't changed while we waited.
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

  // The page (re)started. If it navigated, its old elements are gone: clear its selection (R3.8).
  // If it's the first load, this also sends it an empty selection, which is harmless.
  onAgentMessage("ready", (_data, iframe) => {
    if (useStore.getState().selection.screenId === iframe.dataset.screenId) {
      useStore.getState().clearSelection();
    }
  });

  // Whenever the selection changes, tell the page(s) involved which ids to measure.
  useStore.subscribe((state, previous) => {
    if (state.selection === previous.selection) return;

    const { screenId, ids } = state.selection;
    const before = previous.selection.screenId;

    // The selection moved to another preview (or was cleared): the old page stops measuring.
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
