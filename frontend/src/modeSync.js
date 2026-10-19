import { useStore } from "./store.js";
import { onAgentMessage, sendToPreview, sendToAllPreviews } from "./bridge.js";

// The store owns the mode; pages get a copy. A page that (re)starts says "ready"
// and is sent the current mode, which also covers navigation.
export function startModeSync() {
  useStore.subscribe((state, previous) => {
    if (state.mode !== previous.mode) sendToAllPreviews("set-mode", { mode: state.mode });
  });

  onAgentMessage("ready", (_data, iframe) => {
    sendToPreview(iframe, "set-mode", { mode: useStore.getState().mode });
  });
}
