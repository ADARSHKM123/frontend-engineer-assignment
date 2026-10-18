import { useStore } from "./store.js";
import { onAgentMessage, sendToPreview, findIframeByScreenId } from "./bridge.js";

// Hover (R2). The agent in each page finds the element under the pointer and
// sends { hover: { name, rect } } or { hover: null }. The store keeps the one
// hovered element for the whole board; Preview draws it.
export function startHoverSync() {
  onAgentMessage("hover", (data, iframe) => {
    const screenId = iframe.dataset.screenId;
    const { mode, setHover, clearHover } = useStore.getState();

    if (data.hover && mode === "select") setHover(screenId, data.hover);
    else clearHover(screenId);
  });

  // A page (re)started, e.g. after navigating: its old hover no longer exists.
  onAgentMessage("ready", (_data, iframe) => {
    useStore.getState().clearHover(iframe.dataset.screenId);
  });
}

// The pointer entered (id) or left (null) a row of the layers panel (R4.4).
// The page treats that element as hovered, so the usual hover outline appears
// and the usual "hover" message comes back to the store.
export function hoverRow(screenId, id) {
  const iframe = findIframeByScreenId(screenId);
  if (iframe) sendToPreview(iframe, "set-hover", { id });
}

// Clear the hover because the board started panning or zooming (R2.3).
// The page is told too, so it doesn't re-send the same hover until the pointer moves again.
export function cancelHover() {
  const { hover, clearHover } = useStore.getState();
  if (!hover) return;
  const iframe = findIframeByScreenId(hover.screenId);
  if (iframe) sendToPreview(iframe, "clear-hover");
  clearHover();
}
