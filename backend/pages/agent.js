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
      scheduleHoverCheck();
    }

    if (event.data.type === "clear-hover") {
      // The board started panning or zooming and already cleared the hover.
      // Forget the pointer until it moves again, so we don't re-send the same hover.
      pointer = null;
      hovered = null;
      lastHoverSent = "null";
    }

    if (event.data.type === "set-selection") {
      // The host decided what is selected; we keep measuring those elements.
      selectedIds = event.data.ids;
      lastSelectionSent = ""; // always answer, so the host gets fresh boxes right away
      scheduleSelectionCheck();
    }
  });

  // ---- Names (used in labels and, later, the layers panel) ----
  // data-name, else tag + first class, else tag + id, else the tag alone.
  function nameOf(element) {
    if (element.dataset?.name) return element.dataset.name;
    const tag = element.tagName.toLowerCase();
    const firstClass = element.classList[0];
    if (firstClass) return `${tag}.${firstClass}`;
    if (element.id) return `${tag}#${element.id}`;
    return tag;
  }

  // The element's box relative to the page's viewport, which is the preview frame.
  function rectOf(element) {
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }

  // ---- Element ids ----
  // The host can't hold this page's DOM nodes, so every element we tell it
  // about gets a short id ("e1", "e2", ...). The same element keeps its id.
  //   WeakMap: element -> id. It doesn't keep removed elements alive.
  //   Map of WeakRef: id -> element, to find the element the host asks about.
  //   A WeakRef also lets a removed element be garbage-collected.
  let nextId = 1;
  const idByElement = new WeakMap();
  const elementById = new Map();

  function idOf(element) {
    let id = idByElement.get(element);
    if (!id) {
      id = `e${nextId++}`;
      idByElement.set(element, id);
      elementById.set(id, new WeakRef(element));
    }
    return id;
  }

  // The element with this id, or null if it was removed from the page.
  function findElement(id) {
    const element = elementById.get(id)?.deref();
    return element && element.isConnected ? element : null;
  }

  // ---- Hover (R2) ----
  // We ask the browser which element is under the pointer (elementFromPoint)
  // instead of trusting event.target. That works for every element, including
  // disabled buttons and inputs, SVG shapes, and whatever is on top where a
  // sticky header overlaps the content (R2.4).
  let pointer = null; // last pointer position inside the page, or null when outside
  let hovered = null; // the element currently hovered
  let lastHoverSent = "null"; // what we last told the host, to avoid repeating it
  let hoverFrame = 0; // pending requestAnimationFrame id, 0 when idle

  function elementAt(x, y) {
    const element = document.elementFromPoint(x, y);
    // The page background (<html>/<body>) is never hovered (R2.5).
    if (!element || element === document.documentElement || element === document.body) return null;
    return element;
  }

  function sendHover() {
    let hover = null;
    if (hovered) {
      hover = { id: idOf(hovered), name: nameOf(hovered), rect: rectOf(hovered) };
    }
    // Only send when something changed: pointermove fires very often.
    const key = JSON.stringify(hover);
    if (key === lastHoverSent) return;
    lastHoverSent = key;
    send("hover", { hover });
  }

  // Runs once per animation frame while the pointer is inside the page.
  // Checking every frame (instead of only on pointermove) keeps the outline
  // glued when the page scrolls under a still pointer or the element moves or
  // resizes (R3.4), and it costs one hit-test per frame in one page at a time.
  function checkHover() {
    hoverFrame = 0;
    hovered = mode === "select" && pointer ? elementAt(pointer.x, pointer.y) : null;
    sendHover();
    if (mode === "select" && pointer) hoverFrame = requestAnimationFrame(checkHover);
  }

  function scheduleHoverCheck() {
    if (!hoverFrame) hoverFrame = requestAnimationFrame(checkHover);
  }

  window.addEventListener(
    "pointermove",
    (event) => {
      pointer = { x: event.clientX, y: event.clientY };
      scheduleHoverCheck();
    },
    { capture: true, passive: true },
  );

  // relatedTarget is null when the pointer leaves the page entirely:
  // out of the preview, or out of the browser window (R2.3).
  document.addEventListener(
    "pointerout",
    (event) => {
      if (event.relatedTarget) return;
      pointer = null;
      scheduleHoverCheck();
    },
    { capture: true },
  );

  // ---- Selection (R3) ----
  // The host owns the selection and sends us the selected ids. While anything
  // is selected, we measure those elements every frame and report changes, so
  // their outlines stay glued when the page scrolls (including inner scroll
  // areas) or the elements move or resize (R3.4).
  let selectedIds = [];
  let lastSelectionSent = "";
  let selectionFrame = 0;

  // True when the element is scrolled completely out of a scroll area inside the
  // page (e.g. a row scrolled out of the orders table). It stays selected but gets
  // no outline (R3.4). Scrolling out of the page itself is handled by the host,
  // which clips outlines to the preview's edges.
  function isHiddenByScrollArea(element, rect) {
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.overflowX === "visible" && style.overflowY === "visible") continue;
      const area = parent.getBoundingClientRect();
      const overlaps =
        rect.x < area.right && rect.x + rect.width > area.left &&
        rect.y < area.bottom && rect.y + rect.height > area.top;
      if (!overlaps) return true;
    }
    return false;
  }

  function checkSelection() {
    selectionFrame = 0;
    const boxes = [];
    for (const id of selectedIds) {
      const element = findElement(id);
      if (!element) continue;
      const rect = rectOf(element);
      boxes.push({ id, name: nameOf(element), rect, hidden: isHiddenByScrollArea(element, rect) });
    }
    const key = JSON.stringify(boxes);
    if (key !== lastSelectionSent) {
      lastSelectionSent = key;
      send("selection", { boxes });
    }
    if (selectedIds.length) selectionFrame = requestAnimationFrame(checkSelection);
  }

  function scheduleSelectionCheck() {
    if (!selectionFrame) selectionFrame = requestAnimationFrame(checkSelection);
  }

  // A click in Select mode: tell the host which element is under the pointer
  // (null for the page background). The host decides what that does to the selection.
  function sendPick(event) {
    const element = elementAt(event.clientX, event.clientY);
    send("pick", { id: element ? idOf(element) : null, shiftKey: event.shiftKey });
  }

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
        // pointerdown (not click) so it also works on disabled controls, where
        // browsers don't fire click (R2.4).
        if (type === "pointerdown" && event.button === 0) sendPick(event);
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
