import { useStore } from "./store.js";
import { onAgentMessage, sendToPreview, sendToAllPreviews } from "./bridge.js";

// Keeps every preview page told which mode the board is in (R1.5).
// The store is the source of truth; the pages only get a copy.
//
//   - When the mode changes, send it to every page.
//   - When a page (re)starts and says "ready", send it the current mode.
//     This covers a slow page loading late and a page that navigated (R3.8):
//     the new page's agent says "ready" and gets the mode again.
export function startModeSync() {
  useStore.subscribe((state, previous) => {
    if (state.mode !== previous.mode) sendToAllPreviews("set-mode", { mode: state.mode });
  });

  onAgentMessage("ready", (_data, iframe) => {
    sendToPreview(iframe, "set-mode", { mode: useStore.getState().mode });
  });
}
