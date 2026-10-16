import { useStore } from "./store.js";
import { onAgentMessage, sendToPreview, findIframeByScreenId } from "./bridge.js";

// Selection (R3). The store decides what is selected; the pages only report.
//
//   Page -> host:  "pick"       { id, shiftKey }    a click in Select mode (id null = background)
//   Page -> host:  "selection"  { boxes, missing }  where the selected elements are now,
//                                                    and which ones no longer exist (R3.7)
//   Host -> page:  "set-selection" { ids }          which elements the page should keep measuring
export function startSelectionSync() {
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
