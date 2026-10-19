import { useStore } from "./store.js";
import { onAgentMessage } from "./bridge.js";
import { report } from "../report.js";
import { inRegion } from "./regions.js";

// A preview is connected once its agent says "ready"; otherwise it fails after
// 10 seconds. Page errors forwarded by the agent become a badge.

const CONNECT_TIMEOUT_MS = 10000;
const timers = new Map();
const readySinceLoad = new Map(); // screenId -> said "ready" since the iframe's last load event?

function startTimer(screenId) {
  clearTimeout(timers.get(screenId));
  timers.set(
    screenId,
    setTimeout(
      inRegion("preview", screenId, () => {
        timers.delete(screenId);
        useStore.getState().setConnection(screenId, "failed");
        report(new Error("Couldn't connect to this preview"), { region: "preview", screenId });
      }),
      CONNECT_TIMEOUT_MS,
    ),
  );
}

export function startConnecting(screenId) {
  readySinceLoad.set(screenId, false);
  useStore.getState().setConnection(screenId, "connecting");
  useStore.getState().setPageError(screenId, null);
  startTimer(screenId);
}

// A page loaded without saying "ready" (e.g. it navigated to a page without the
// agent): start the 10 s timer again.
export function pageLoaded(screenId) {
  if (!readySinceLoad.get(screenId) && !timers.has(screenId)) startTimer(screenId);
  readySinceLoad.set(screenId, false);
}

export function stopConnecting(screenId) {
  clearTimeout(timers.get(screenId));
  timers.delete(screenId);
}

export function startPreviewSync() {
  onAgentMessage("ready", (_data, iframe) => {
    const screenId = iframe.dataset.screenId;
    // After a timeout the error stays until Retry; a late "ready" changes nothing.
    if (useStore.getState().connections[screenId] === "failed") return;
    readySinceLoad.set(screenId, true);
    stopConnecting(screenId);
    useStore.getState().setConnection(screenId, "connected");
    useStore.getState().setPageError(screenId, null);
  });

  onAgentMessage("page-error", (data, iframe) => {
    const screenId = iframe.dataset.screenId;
    const message = String(data.message || "Unknown error");
    useStore.getState().setPageError(screenId, message);
    report(new Error(message), { region: "preview", screenId });
  });
}
