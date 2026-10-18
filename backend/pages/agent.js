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
      // Forget fingerprints of elements that are no longer selected.
      for (const id of fingerprints.keys()) if (!selectedIds.includes(id)) fingerprints.delete(id);
      lastSelectionSent = ""; // always answer, so the host gets fresh boxes right away
      scheduleSelectionCheck();
    }

    if (event.data.type === "navigate") {
      // Keyboard navigation (R3.5): the host asks "from this element, go to its
      // first child / parent / next / previous sibling". We answer with an id, or null.
      const from = locateSelected(event.data.id);
      const target = from ? navigateFrom(from, event.data.direction) : null;
      let id = null;
      if (target) {
        id = idOf(target);
        fingerprints.set(id, fingerprintOf(target)); // so it survives a rebuild, like a click (R3.7)
      }
      send("navigated", { from: event.data.id, id });
    }
  });

  // ---- Keyboard navigation (R3.5) ----
  // Tags that are never drawn on screen. Skipping them means Tab never lands on
  // an invisible <script> or <style>, and Enter never "selects" one.
  const HIDDEN_TAGS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "LINK", "META"]);

  function visibleChildren(element) {
    return [...element.children].filter((child) => !HIDDEN_TAGS.has(child.tagName));
  }

  // direction: "first-child" (Enter), "parent" (Shift+Enter),
  //            "next" (Tab), "previous" (Shift+Tab). Returns an element or null.
  function navigateFrom(element, direction) {
    if (direction === "first-child") {
      return visibleChildren(element)[0] || null; // no children: nothing happens
    }

    if (direction === "parent") {
      const parent = element.parentElement;
      // Children of <body> are the top level: "Nothing happens at the top level".
      if (!parent || parent === document.body || parent === document.documentElement) return null;
      return parent;
    }

    // "next" / "previous": move among the siblings, wrapping around at the ends.
    const siblings = visibleChildren(element.parentElement);
    const index = siblings.indexOf(element);
    const step = direction === "next" ? 1 : -1;
    return siblings[(index + step + siblings.length) % siblings.length];
  }

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

  // ---- Identity across re-renders (R3.7) ----
  // Some pages rebuild their DOM (e.g. innerHTML on every tick): a selected
  // element is replaced by a brand-new node that looks the same. To keep it
  // selected, we remember a "fingerprint" of WHERE each selected element is,
  // and when its node disappears we use the fingerprint to find the new node.
  //
  // A fingerprint is:
  //   anchor: the nearest element with a data-key — the element itself, an
  //           ancestor, or a keyed sibling a few elements before/after it
  //   path:   the child steps from the anchor down to the element
  //   signatures: tag + id + classes + data-key + data-name at every step
  //
  // Rule: never jump to a different element. Any doubt (key not unique, the
  // two sibling anchors disagree, a signature differs) means "no longer exists".
  // Text is NOT part of it: text may change ("4s ago") while the element stays.
  const fingerprints = new Map(); // id -> latest fingerprint, refreshed every frame

  function signatureOf(element) {
    const signature = [
      element.tagName,
      element.id,
      element.getAttribute("class") || "",
      element.dataset?.key || "",
      element.dataset?.name || "",
    ].join("|");

    // console.log("SIGNATURE", signature);

    return signature;
  }


  function indexOf(element) {
    return Array.prototype.indexOf.call(element.parentElement.children, element);
  }

  // The nearest sibling with a data-key, walking in one direction (-1 = before, +1 = after).
  function keyedSibling(element, direction) {
    let distance = 0;
    let sibling = element;
    while ((sibling = direction < 0 ? sibling.previousElementSibling : sibling.nextElementSibling)) {
      distance++;
      if (sibling.dataset?.key) return { key: sibling.dataset.key, distance };
    }
    return null;
  }

  function fingerprintOf(element) {
    // console.log('FROM FINGERPRINTOF', element)
    const path = []; // [{ index, signature }] from the anchor down to the element
    for (let node = element; node.parentElement && node !== document.body; node = node.parentElement) {
      const signature = signatureOf(node);
      if (node.dataset?.key) return { self: node.dataset.key, signature, path };
      // console.log('NODE', node)
      const before = keyedSibling(node, -1);
      const after = keyedSibling(node, +1);
      if (before || after) return { before, after, signature, path };
      path.unshift({ index: indexOf(node), signature });
    }
    return { signature: signatureOf(document.body), path }; // no key anywhere: anchored at <body>
  }

  // The one element with this data-key, or null if there are none or several.
  function uniqueByKey(key) {
    const matches = document.querySelectorAll(`[data-key="${CSS.escape(key)}"]`);
    return matches.length === 1 ? matches[0] : null;
  }

  function siblingAt(element, steps) {
    let node = element;
    for (let i = 0; i < Math.abs(steps) && node; i++) {
      node = steps < 0 ? node.previousElementSibling : node.nextElementSibling;
    }
    return node;
  }

  // Find the element a fingerprint describes in the current DOM, or null.
  function resolve(fp) {
    let start;
    if (fp.self) {
      start = uniqueByKey(fp.self);
    } else if (fp.before || fp.after) {
      // Count forward from the keyed sibling before it, and/or back from the one after it.
      const fromBefore = fp.before && uniqueByKey(fp.before.key);
      const fromAfter = fp.after && uniqueByKey(fp.after.key);
      const a = fromBefore ? siblingAt(fromBefore, fp.before.distance) : null;
      const b = fromAfter ? siblingAt(fromAfter, -fp.after.distance) : null;
      if (a && b && a !== b) return null; // the two anchors disagree: don't guess
      start = a || b;
    } else {
      start = document.body;
    }
    if (!start || signatureOf(start) !== fp.signature) return null;

    let node = start;
    for (const step of fp.path) {
      node = node.children[step.index];
      if (!node || signatureOf(node) !== step.signature) return null;
    }
    return node;
  }

  // The selected element with this id: the same node if it's still in the page,
  // otherwise its replacement found by fingerprint (which then takes over the id),
  // otherwise null: it no longer exists.
  function locateSelected(id) {
    let element = findElement(id);
    if (!element) {
      const fp = fingerprints.get(id);
      element = fp ? resolve(fp) : null;
      if (!element) return null;
      idByElement.set(element, id); // the new node takes over the old id
      elementById.set(id, new WeakRef(element));
    }
    fingerprints.set(id, fingerprintOf(element)); // keep it fresh while the element is alive
    return element;
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
    const missing = []; // selected ids whose element no longer exists (R3.7)
    for (const id of selectedIds) {
      const element = locateSelected(id);
      if (!element) {
        missing.push(id);
        continue;
      }
      const rect = rectOf(element);
      boxes.push({ id, name: nameOf(element), rect, hidden: isHiddenByScrollArea(element, rect) });
    }
    const key = JSON.stringify({ boxes, missing });
    if (key !== lastSelectionSent) {
      lastSelectionSent = key;
      send("selection", { boxes, missing });
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
    const id = element ? idOf(element) : null;
    // Fingerprint it now, so a rebuild during the round trip to the host can't lose it.
    if (element) fingerprints.set(id, fingerprintOf(element));
    send("pick", { id, shiftKey: event.shiftKey });
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
