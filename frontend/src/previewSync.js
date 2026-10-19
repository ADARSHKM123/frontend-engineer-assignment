import { useStore } from "./store.js";
import { onAgentMessage } from "./bridge.js";
import { report } from "../report.js";
import { inRegion } from "./regions.js";

// The health of each preview (R6.2, R6.3).
//
// Connection: a preview is "connected" once its page's agent says "ready". If
// that doesn't happen within 10 seconds, the page didn't load or its script
// isn't answering: the preview shows "Couldn't connect to this preview".
//
//   mount / Retry      → "connecting", start the 10s timer
//   "ready"            → "connected", stop the timer
//   iframe load event  → a page finished loading. If it never said "ready"
//                        (e.g. it navigated to a page without the agent, or the
//                        server sent an error page), start the 10s timer again.
//
// Page errors: the agent forwards the page's own uncaught errors and rejected
// promises; the preview shows them as a "Page error" badge.

const CONNECT_TIMEOUT_MS = 10000;
const timers = new Map(); // screenId -> 10s timer
const readySinceLoad = new Map(); // screenId -> did the agent say "ready" since the last load event?

function startTimer(screenId) {
  clearTimeout(timers.get(screenId));
  timers.set(
    screenId,
    // inRegion: an error inside the timer fails this preview instead of being lost (R6.5).
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

// The preview's iframe was created (first time, or by Retry).
export function startConnecting(screenId) {
  readySinceLoad.set(screenId, false);
  useStore.getState().setConnection(screenId, "connecting");
  useStore.getState().setPageError(screenId, null);
  startTimer(screenId);
}

// The preview's iframe finished loading a page.
export function pageLoaded(screenId) {
  if (!readySinceLoad.get(screenId) && !timers.has(screenId)) startTimer(screenId);
  readySinceLoad.set(screenId, false); // the next page (after navigating) must say "ready" again
}

// The preview is gone (unmounted): stop its timer, so it can't fail later (R6.6).
export function stopConnecting(screenId) {
  clearTimeout(timers.get(screenId));
  timers.delete(screenId);
}

export function startPreviewSync() {
  onAgentMessage("ready", (_data, iframe) => {
    const screenId = iframe.dataset.screenId;
    // After a timeout the preview shows its error until Retry; a late "ready" changes nothing.
    if (useStore.getState().connections[screenId] === "failed") return;
    readySinceLoad.set(screenId, true);
    stopConnecting(screenId);
    useStore.getState().setConnection(screenId, "connected");
    useStore.getState().setPageError(screenId, null); // a new page: the old page's error is gone
  });

  // R6.3: an error inside the page. Shown as a badge, and reported once.
  onAgentMessage("page-error", (data, iframe) => {
    const screenId = iframe.dataset.screenId;
    const message = String(data.message || "Unknown error");
    useStore.getState().setPageError(screenId, message);
    report(new Error(message), { region: "preview", screenId });
  });
}
