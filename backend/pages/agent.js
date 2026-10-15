// Agent: the one script added to every preview page.
// The host app is on a different origin, so it cannot read or listen inside this page.
// This script runs inside the page and talks to the host with postMessage.
//
//   Page -> host:  { source: "figr-agent", type, ...data }
//   Host -> page:  { source: "figr-host",  type, ...data }
//
// It is loaded in <head>, before the page's own scripts, so its listeners are
// registered first and run before the page's listeners.

(() => {
  // Start in Select mode until the host says otherwise. Safer default: if the
  // host is slow to answer, clicks are blocked instead of leaking into the page.
  let mode = "select";

  function send(type, data) {
    // "*" because the page does not know the host's origin. The host checks
    // where each message came from before trusting it.
    window.parent.postMessage({ source: "figr-agent", type, ...data }, "*");
  }

  // ---- Messages from the host ----
  window.addEventListener("message", (event) => {
    // Only the window that embeds us (the host) may give orders.
    if (event.source !== window.parent || event.data?.source !== "figr-host") return;

    if (event.data.type === "set-mode") {
      mode = event.data.mode;
      // Entering Select mode: drop focus, so a field focused in Interact mode stops taking keys.
      if (mode === "select") document.activeElement?.blur();
    }
  });

  // ---- Select mode: clicks never reach the page (R1.5) ----
  // Listening on window in the capture phase means we see each event before
  // any element in the page does. stopImmediatePropagation stops the page's
  // own listeners; preventDefault stops the browser's default action
  // (following a link, submitting a form, focusing an input, opening a menu).
  const blockedEvents = [
    "pointerdown", "pointerup", "mousedown", "mouseup",
    "click", "dblclick", "auxclick", "contextmenu",
    "touchstart", "touchend", "dragstart", "submit",
  ];
  for (const type of blockedEvents) {
    window.addEventListener(
      type,
      (event) => {
        if (mode !== "select") return;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      { capture: true, passive: false },
    );
  }

  // ---- Keys: shortcuts must work right after clicking in a preview (R3.6) ----
  function isTyping(element) {
    if (!element) return false;
    const tag = element.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable;
  }

  window.addEventListener(
    "keydown",
    (event) => {
      // Interact mode: the page works normally. Keys typed into a field stay there.
      if (mode === "interact" && isTyping(event.target)) return;

      send("key", {
        key: event.key,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
      });

      // Select mode: the page must not react to keys either (no Tab focus, no Enter submit).
      if (mode === "select") {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    { capture: true },
  );

  // ---- Zoom: Ctrl/Cmd + wheel zooms the board, even over a preview (R1.3) ----
  // The browser delivers that wheel event to this page, not to the host, so we
  // stop the page from handling it and pass it on. A plain wheel is left alone,
  // so the page still scrolls normally (R1.4).
  window.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      send("zoom-wheel", {
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        x: event.clientX, // pointer position inside the page, in page pixels
        y: event.clientY,
      });
    },
    { passive: false }, // needed so preventDefault() is allowed on wheel
  );

  // ---- Handshake ----
  // Tell the host this page's agent is running, so it can send the current mode.
  // This also runs again after the preview navigates to a new page (R3.8).
  send("ready", {});
})();
