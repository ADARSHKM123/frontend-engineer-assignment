import { PAGES_ORIGIN } from "./config.js";
import { inRegion } from "./regions.js";

// The only place messages from the preview pages (agent.js) arrive.
// Page -> host messages carry source "figr-agent", host -> page ones "figr-host".

const handlers = {}; // message type -> Set of { handler, region }

// `region` is the region that fails if the handler throws.
export function onAgentMessage(type, handler, region = "preview") {
  const entry = { handler, region };
  handlers[type] ??= new Set();
  handlers[type].add(entry);
  return () => handlers[type].delete(entry);
}

function findIframe(sourceWindow) {
  return [...document.querySelectorAll(".preview iframe")].find(
    (iframe) => iframe.contentWindow === sourceWindow,
  );
}

export function findIframeByScreenId(screenId) {
  return document.querySelector(`.preview iframe[data-screen-id="${screenId}"]`);
}

window.addEventListener("message", (event) => {
  // Trust only our own agent, in one of our own previews.
  if (event.origin !== PAGES_ORIGIN) return;
  if (event.data?.source !== "figr-agent") return;

  const iframe = findIframe(event.source);
  if (!iframe) return;

  const screenId = iframe.dataset.screenId;
  handlers[event.data.type]?.forEach(({ handler, region }) => {
    inRegion(region, screenId, handler)(event.data, iframe);
  });
});

export function sendToPreview(iframe, type, data = {}) {
  iframe.contentWindow?.postMessage({ source: "figr-host", type, ...data }, PAGES_ORIGIN);
}

export function sendToAllPreviews(type, data = {}) {
  for (const iframe of document.querySelectorAll(".preview iframe")) {
    sendToPreview(iframe, type, data);
  }
}
