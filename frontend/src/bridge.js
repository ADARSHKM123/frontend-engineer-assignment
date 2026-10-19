import { PAGES_ORIGIN } from "./config.js";
import { inRegion } from "./regions.js";

// The bridge: the one place where the host talks to the preview pages.
// Each page runs backend/pages/agent.js, which sends and receives postMessage.
//
//   Page -> host:  { source: "figr-agent", type, ...data }
//   Host -> page:  { source: "figr-host",  type, ...data }
//
// Every incoming message is checked here, once, before any handler sees it.

const handlers = {}; // message type -> Set of { handler(data, iframe), region }

// Register a function that handles one message type from the pages.
// Several features may listen to the same type (e.g. "ready").
// `region` is the region that fails if the handler throws (R6.5). By default it's
// the preview the message came from; layers messages pass "layers".
// Returns a function that unregisters it (handy as a useEffect cleanup).
export function onAgentMessage(type, handler, region = "preview") {
  const entry = { handler, region };
  handlers[type] ??= new Set();
  handlers[type].add(entry);
  return () => handlers[type].delete(entry);
}

// Find the preview iframe whose page sent a message.
function findIframe(sourceWindow) {
  return [...document.querySelectorAll(".preview iframe")].find(
    (iframe) => iframe.contentWindow === sourceWindow,
  );
}

// Find a preview iframe by its screen id (set as data-screen-id in Preview.jsx).
export function findIframeByScreenId(screenId) {
  return document.querySelector(`.preview iframe[data-screen-id="${screenId}"]`);
}

window.addEventListener("message", (event) => {
  if (event.origin !== PAGES_ORIGIN) return; // only trust the preview pages
  if (event.data?.source !== "figr-agent") return; // only our agent's messages

  const iframe = findIframe(event.source);
  if (!iframe) return; // not one of our previews

  // Each handler runs inside its region: if it throws, that region shows the
  // error and it's reported once, instead of the error being lost (R6.5).
  const screenId = iframe.dataset.screenId;
  handlers[event.data.type]?.forEach(({ handler, region }) => {
    inRegion(region, screenId, handler)(event.data, iframe);
  });
});

// Send a message to one preview page.
export function sendToPreview(iframe, type, data = {}) {
  iframe.contentWindow?.postMessage({ source: "figr-host", type, ...data }, PAGES_ORIGIN);
}

// Send a message to every preview page on the board.
export function sendToAllPreviews(type, data = {}) {
  for (const iframe of document.querySelectorAll(".preview iframe")) {
    sendToPreview(iframe, type, data);
  }
}
