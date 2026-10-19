import { useStore } from "./store.js";
import { onAgentMessage, sendToPreview, findIframeByScreenId } from "./bridge.js";

export function startHoverSync() {
  onAgentMessage("hover", (data, iframe) => {
    const screenId = iframe.dataset.screenId;
    const { mode, setHover, clearHover } = useStore.getState();

    if (data.hover && mode === "select") setHover(screenId, data.hover);
    else clearHover(screenId);
  });

  onAgentMessage("ready", (_data, iframe) => {
    useStore.getState().clearHover(iframe.dataset.screenId);
  });
}

// A layers row is hovered: the page treats that element as hovered, so the
// normal hover outline and "hover" message follow.
export function hoverRow(screenId, id) {
  const iframe = findIframeByScreenId(screenId);
  if (iframe) sendToPreview(iframe, "set-hover", { id });
}

// The board started panning or zooming. The page is told too, so it
// doesn't re-send the same hover until the pointer moves again.
export function cancelHover() {
  const { hover, clearHover } = useStore.getState();
  if (!hover) return;
  const iframe = findIframeByScreenId(hover.screenId);
  if (iframe) sendToPreview(iframe, "clear-hover");
  clearHover();
}
