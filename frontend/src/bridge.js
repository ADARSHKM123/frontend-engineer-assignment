import { PAGES_ORIGIN } from "./config.js";

// The bridge: the one place where the host talks to the preview pages.
// Each page runs backend/pages/agent.js, which sends and receives postMessage.
//
//   Page -> host:  { source: "figr-agent", type, ...data }
//   Host -> page:  { source: "figr-host",  type, ...data }
//
// Every incoming message is checked here, once, before any handler sees it.

const handlers = {}; // message type -> function(data, iframe)

// Register the function that handles one message type from the pages.
// Returns a function that unregisters it (handy as a useEffect cleanup).
export function onAgentMessage(type, handler) {
  handlers[type] = handler;
  return () => {
    if (handlers[type] === handler) delete handlers[type];
  };
}

// Find the preview iframe whose page sent a message.
function findIframe(sourceWindow) {
  return [...document.querySelectorAll(".preview iframe")].find(
    (iframe) => iframe.contentWindow === sourceWindow,
  );
}

window.addEventListener("message", (event) => {
  if (event.origin !== PAGES_ORIGIN) return; // only trust the preview pages
  if (event.data?.source !== "figr-agent") return; // only our agent's messages

  const iframe = findIframe(event.source);
  if (!iframe) return; // not one of our previews

  handlers[event.data.type]?.(event.data, iframe);
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
