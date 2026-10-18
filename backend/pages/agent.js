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
      rowHoverId = null;
      hovered = null;
      lastHoverSent = "null";
    }

    if (event.data.type === "set-hover") {
      // The pointer is over a row in the layers panel (R4.4): treat that element
      // as hovered, so the normal hover loop draws and follows its outline.
      rowHoverId = event.data.id;
      scheduleHoverCheck();
    }

    if (event.data.type === "scroll-into-view") {
      // A layers row was clicked (R4.6): scroll this page so the element shows.
      const element = findElement(event.data.id);
      if (element) scrollIntoViewInsidePage(element);
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

    if (event.data.type === "get-children") {
      // Layers panel (R4.2, R4.3): "what are the children of this element?"
      // parentId null means the top level, which is the children of <body>.
      // delayMs lets the dev menu simulate a slow page (R6.7); normally 0.
      const { requestId, parentId, delayMs = 0 } = event.data;
      const children = listChildren(parentId) ?? [];
      // From now on, tell the host when this list changes (R4.10).
      watchedParents.set(parentId, JSON.stringify(children));
      setTimeout(() => send("children", { requestId, parentId, children }), delayMs);
    }

    if (event.data.type === "search") {
      // Layers search (R4.11). An empty query stops searching.
      searchQuery = event.data.query;
      lastSearchSent = ""; // always answer a new query
      if (searchQuery) setTimeout(sendSearchResults, event.data.delayMs ?? 0);
    }
  });

  // ---- Layers search (R4.11) ----
  // The host only knows the rows it has loaded, but search must cover the whole
  // tree. So the page searches its own DOM: every element whose name contains the
  // text, plus all its ancestors so the panel can show where it is.
  let searchQuery = ""; // the current search, "" when not searching
  let lastSearchSent = ""; // what we last sent, so page changes only resend real differences

  function sendSearchResults() {
    if (!searchQuery) return;
    const text = searchQuery.toLowerCase();
    const all = [...document.body.querySelectorAll("*")].filter((el) => !HIDDEN_TAGS.has(el.tagName));

    // 1. Mark every match and every ancestor of a match.
    const shown = new Set();
    for (const element of all) {
      if (!nameOf(element).toLowerCase().includes(text)) continue;
      for (let node = element; node && node !== document.body; node = node.parentElement) shown.add(node);
    }

    // 2. List them in document order, so each parent comes before its children.
    const rows = all
      .filter((element) => shown.has(element))
      .map((element) => {
        const row = describeForLayers(element);
        rowFingerprints.set(row.id, fingerprintOf(element)); // keep its id across rebuilds (R4.10)
        return {
          ...row,
          parentId: element.parentElement === document.body ? null : idOf(element.parentElement),
          match: nameOf(element).toLowerCase().includes(text), // false = only shown as an ancestor
        };
      });

    const json = JSON.stringify(rows);
    if (json === lastSearchSent) return;
    lastSearchSent = json;
    send("search-results", { query: searchQuery, rows });
  }

  // ---- Keeping the layers panel in step with the page (R4.10) ----
  // The panel has loaded the children of some parents ("watched" parents). When
  // the page changes its DOM, we rebuild those lists and send the ones that changed.
  //
  // Pages like page 4 rebuild everything with innerHTML: every element is a new
  // node. To keep each row's id (and with it its open state and selection), every
  // row has a fingerprint, the same as selected elements (R3.7). When a row's node
  // is gone, its replacement found by fingerprint takes over the id.
  const watchedParents = new Map(); // parentId (null = <body>) -> the list we last sent, as JSON
  const rowFingerprints = new Map(); // row id -> fingerprint

  // The children of a parent as layers rows, or null if the parent no longer exists.
  function listChildren(parentId) {
    const parent = parentId === null ? document.body : findElement(parentId);
    if (!parent) return null;
    return visibleChildren(parent).map((child) => {
      const row = describeForLayers(child);
      rowFingerprints.set(row.id, fingerprintOf(child)); // fresh, for the next rebuild
      return row;
    });
  }

  // Give every lost row's id to the new node that replaced it, if there is one.
  // `claimed` stops two old rows from taking the same new node.
  function relocateRows() {
    const claimed = new Set();
    for (const [id, fingerprint] of rowFingerprints) {
      const current = findElement(id);
      if (current) {
        claimed.add(current);
        continue;
      }
      const replacement = resolve(fingerprint);
      if (replacement && !claimed.has(replacement)) {
        claimed.add(replacement);
        idByElement.set(replacement, id);
        elementById.set(id, new WeakRef(replacement));
      } else {
        rowFingerprints.delete(id); // gone for good: its row disappears from the panel
      }
    }
  }

  function onPageChanged() {
    // Selected elements first, so a selected row keeps the selection's id (R3.7).
    for (const id of selectedIds) locateSelected(id);
    relocateRows();

    for (const [parentId, lastSent] of watchedParents) {
      const children = listChildren(parentId);
      if (children === null) {
        watchedParents.delete(parentId); // the parent itself is gone; its own parent's list says so
        continue;
      }
      const json = JSON.stringify(children);
      if (json === lastSent) continue; // nothing visible changed for this list
      watchedParents.set(parentId, json);
      send("children-changed", { parentId, children });
    }

    sendSearchResults(); // a search in progress stays correct while the page changes
  }

  // Watch the whole document: added/removed elements anywhere, and the attributes
  // a row's name depends on. <html>, because <body> doesn't exist yet when this
  // script runs in <head>.
  new MutationObserver(onPageChanged).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "id", "data-name", "data-key"],
  });

  // The ids of an element's ancestors, top-level first, not counting <body>.
  // For <body> > main > section > h2 this is [id of main, id of section].
  // The layers panel uses them to find (and open) the rows above an element.
  function ancestorIdsOf(element) {
    const ids = [];
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      ids.unshift(idOf(parent));
    }
    return ids;
  }

  // Scroll this page (and any scroll areas inside it) just enough to show the
  // element (R4.6). Done by hand on purpose: the browser's scrollIntoView() may
  // also scroll the host app's board, and R4.6 says only the page may move.
  function scrollIntoViewInsidePage(element) {
    // How far to scroll so [start, end] fits inside [viewStart, viewEnd]; 0 if it already does.
    function distance(start, end, viewStart, viewEnd) {
      if (start < viewStart) return start - viewStart;
      if (end > viewEnd) return Math.min(start - viewStart, end - viewEnd);
      return 0;
    }

    // 1. Scroll areas inside the page, innermost first (e.g. the orders table on page 3).
    for (let box = element.parentElement; box && box !== document.body; box = box.parentElement) {
      const style = getComputedStyle(box);
      if (!/(auto|scroll)/.test(style.overflowX + style.overflowY)) continue;
      const r = element.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      box.scrollTop += distance(r.top, r.bottom, b.top + box.clientTop, b.top + box.clientTop + box.clientHeight);
      box.scrollLeft += distance(r.left, r.right, b.left + box.clientLeft, b.left + box.clientLeft + box.clientWidth);
    }

    // 2. The page itself. window.scrollBy only ever scrolls this iframe's document.
    const r = element.getBoundingClientRect();
    window.scrollBy(distance(r.left, r.right, 0, window.innerWidth), distance(r.top, r.bottom, 0, window.innerHeight));
  }

  // One row of the layers panel: enough to draw it, without its children.
  // hasChildren decides whether the row gets a chevron (R4.2).
  function describeForLayers(element) {
    return {
      id: idOf(element),
      name: nameOf(element),
      key: element.dataset?.key || null,
      hasChildren: visibleChildren(element).length > 0,
    };
  }

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
    return [
      element.tagName,
      element.id,
      element.getAttribute("class") || "",
      element.dataset?.key || "",
      element.dataset?.name || "",
    ].join("|");
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
    const path = []; // [{ index, signature }] from the anchor down to the element
    for (let node = element; node.parentElement && node !== document.body; node = node.parentElement) {
      const signature = signatureOf(node);
      if (node.dataset?.key) return { self: node.dataset.key, signature, path };
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
  let rowHoverId = null; // element whose layers row is hovered (R4.4), or null
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
      hover = {
        id: idOf(hovered),
        name: nameOf(hovered),
        rect: rectOf(hovered),
        ancestors: ancestorIdsOf(hovered), // lets the layers panel highlight its row (R4.4)
      };
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
  // The hovered element comes from the pointer when it is inside this page,
  // otherwise from a hovered layers row.
  function checkHover() {
    hoverFrame = 0;
    if (mode !== "select") hovered = null;
    else if (pointer) hovered = elementAt(pointer.x, pointer.y);
    else if (rowHoverId) hovered = findElement(rowHoverId);
    else hovered = null;
    sendHover();
    if (mode === "select" && (pointer || rowHoverId)) hoverFrame = requestAnimationFrame(checkHover);
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

  // What the inspector shows about an element (R5.1), read from the page itself.
  // It is part of the selection box, which we re-check every frame and re-send
  // when anything changed, so the inspector updates when the element changes.
  function liveInfoOf(element, rect) {
    const style = getComputedStyle(element); // the final values the browser actually uses
    return {
      tag: element.tagName.toLowerCase(),
      elementId: element.id || "",
      classes: [...element.classList].join(" "),
      key: element.dataset?.key || null, // for GET /elements/:key (Details)
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      // Position within the page = position on screen + how far the page is scrolled.
      x: Math.round(rect.x + window.scrollX),
      y: Math.round(rect.y + window.scrollY),
      // The first 120 characters of its text, with runs of spaces and new lines squeezed to one space.
      text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
      color: style.color,
      background: style.backgroundColor,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
    };
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
      boxes.push({
        id,
        name: nameOf(element),
        rect,
        hidden: isHiddenByScrollArea(element, rect),
        ancestors: ancestorIdsOf(element), // lets the layers panel open its ancestors (R4.5)
        info: liveInfoOf(element, rect), // the inspector's Live section (R5.1)
      });
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

  // ---- Errors inside the page (R6.3) ----
  // The page's own uncaught errors (page 1's "Watch demo" button) and rejected
  // promises nobody handled (page 6's analytics) are passed to the host, which
  // shows them as a "Page error" badge on this preview. The page keeps running.
  window.addEventListener("error", (event) => {
    send("page-error", { message: event.message || "Unknown error" });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    send("page-error", { message: reason?.message ?? String(reason) });
  });

  // ---- Handshake ----
  // Tell the host this page's agent is running, so it can send the current mode.
  // This also runs again after the preview navigates to a new page (R3.8).
  send("ready", {});
})();
