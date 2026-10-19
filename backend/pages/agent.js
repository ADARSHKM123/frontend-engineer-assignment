// Agent: the one script added to every preview page. The host is on another origin
// and can't touch this page, so this script does it and talks to the host with postMessage.
// Loaded in <head>, so its listeners run before the page's own.

(() => {
  // Safer default: if the host is slow, clicks are blocked rather than leaking into the page.
  let mode = "select";

  function send(type, data) {
    // "*" because the page doesn't know the host's origin; the host checks the sender.
    window.parent.postMessage({ source: "figr-agent", type, ...data }, "*");
  }

  // ---- Messages from the host (only the window that embeds us) ----
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.data?.source !== "figr-host") return;

    if (event.data.type === "set-mode") {
      mode = event.data.mode;
      if (mode === "select") document.activeElement?.blur();
      scheduleHoverCheck();
    }

    if (event.data.type === "clear-hover") {
      // Forget the pointer until it moves again, so the same hover isn't re-sent.
      pointer = null;
      rowHoverId = null;
      hovered = null;
      lastHoverSent = "null";
    }

    if (event.data.type === "set-hover") {
      // A layers row is hovered: the normal hover loop follows that element.
      rowHoverId = event.data.id;
      scheduleHoverCheck();
    }

    if (event.data.type === "scroll-into-view") {
      const element = findElement(event.data.id);
      if (element) scrollIntoViewInsidePage(element);
    }

    if (event.data.type === "set-selection") {
      selectedIds = event.data.ids;
      for (const id of fingerprints.keys()) if (!selectedIds.includes(id)) fingerprints.delete(id);
      lastSelectionSent = ""; // always answer at least once
      scheduleSelectionCheck();
    }

    if (event.data.type === "navigate") {
      const from = locateSelected(event.data.id);
      const target = from ? navigateFrom(from, event.data.direction) : null;
      let id = null;
      if (target) {
        id = idOf(target);
        fingerprints.set(id, fingerprintOf(target)); // so it survives a rebuild
      }
      send("navigated", { from: event.data.id, id });
    }

    if (event.data.type === "get-children") {
      // parentId null = the top level (children of <body>). delayMs is for the dev menu.
      const { requestId, parentId, delayMs = 0 } = event.data;
      const children = listChildren(parentId) ?? [];
      watchedParents.set(parentId, JSON.stringify(children));
      setTimeout(() => send("children", { requestId, parentId, children }), delayMs);
    }

    if (event.data.type === "search") {
      searchQuery = event.data.query;
      lastSearchSent = "";
      if (searchQuery) setTimeout(sendSearchResults, event.data.delayMs ?? 0);
    }
  });

  // ---- Layers search ----
  // The page searches its whole DOM, so rows the host never loaded are found too.
  let searchQuery = "";
  let lastSearchSent = "";

  function sendSearchResults() {
    if (!searchQuery) return;
    const text = searchQuery.toLowerCase();
    const all = [...document.body.querySelectorAll("*")].filter((el) => !HIDDEN_TAGS.has(el.tagName));

    // Every match plus its ancestors, so the panel can show where it is.
    const shown = new Set();
    for (const element of all) {
      if (!nameOf(element).toLowerCase().includes(text)) continue;
      for (let node = element; node && node !== document.body; node = node.parentElement) shown.add(node);
    }

    // Document order puts every parent before its children.
    const rows = all
      .filter((element) => shown.has(element))
      .map((element) => {
        const row = describeForLayers(element);
        rowFingerprints.set(row.id, fingerprintOf(element));
        return {
          ...row,
          parentId: element.parentElement === document.body ? null : idOf(element.parentElement),
          match: nameOf(element).toLowerCase().includes(text),
        };
      });

    const json = JSON.stringify(rows);
    if (json === lastSearchSent) return;
    lastSearchSent = json;
    send("search-results", { query: searchQuery, rows });
  }

  // ---- Keeping the layers panel in step with the page ----
  // When the page changes, resend the child lists the panel has loaded. Rows have
  // fingerprints like selected elements, so a rebuilt row keeps its id.
  const watchedParents = new Map(); // parentId -> the list we last sent, as JSON
  const rowFingerprints = new Map();

  function listChildren(parentId) {
    const parent = parentId === null ? document.body : findElement(parentId);
    if (!parent) return null;
    return visibleChildren(parent).map((child) => {
      const row = describeForLayers(child);
      rowFingerprints.set(row.id, fingerprintOf(child));
      return row;
    });
  }

  // Each lost row's id moves to the node that replaced it; two rows can't claim the same node.
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
        rowFingerprints.delete(id);
      }
    }
  }

  function onPageChanged() {
    // Selected elements first, so a selected row keeps the selection's id.
    for (const id of selectedIds) locateSelected(id);
    relocateRows();

    for (const [parentId, lastSent] of watchedParents) {
      const children = listChildren(parentId);
      if (children === null) {
        watchedParents.delete(parentId);
        continue;
      }
      const json = JSON.stringify(children);
      if (json === lastSent) continue;
      watchedParents.set(parentId, json);
      send("children-changed", { parentId, children });
    }

    sendSearchResults();
  }

  // <html>, because <body> doesn't exist yet when this runs in <head>.
  new MutationObserver(onPageChanged).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "id", "data-name", "data-key"],
  });

  // Top-level first, not counting <body>. The panel uses them to find and open rows.
  function ancestorIdsOf(element) {
    const ids = [];
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      ids.unshift(idOf(parent));
    }
    return ids;
  }

  // By hand on purpose: the browser's scrollIntoView() can also scroll the host's
  // board, and only the page should move.
  function scrollIntoViewInsidePage(element) {
    function distance(start, end, viewStart, viewEnd) {
      if (start < viewStart) return start - viewStart;
      if (end > viewEnd) return Math.min(start - viewStart, end - viewEnd);
      return 0;
    }

    for (let box = element.parentElement; box && box !== document.body; box = box.parentElement) {
      const style = getComputedStyle(box);
      if (!/(auto|scroll)/.test(style.overflowX + style.overflowY)) continue;
      const r = element.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      box.scrollTop += distance(r.top, r.bottom, b.top + box.clientTop, b.top + box.clientTop + box.clientHeight);
      box.scrollLeft += distance(r.left, r.right, b.left + box.clientLeft, b.left + box.clientLeft + box.clientWidth);
    }

    const r = element.getBoundingClientRect();
    window.scrollBy(distance(r.left, r.right, 0, window.innerWidth), distance(r.top, r.bottom, 0, window.innerHeight));
  }

  function describeForLayers(element) {
    return {
      id: idOf(element),
      name: nameOf(element),
      key: element.dataset?.key || null,
      hasChildren: visibleChildren(element).length > 0,
    };
  }

  // ---- Keyboard navigation ----
  // Never drawn, so they're never navigated to, listed or found.
  const HIDDEN_TAGS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "LINK", "META"]);

  function visibleChildren(element) {
    return [...element.children].filter((child) => !HIDDEN_TAGS.has(child.tagName));
  }

  // direction: "first-child" | "parent" | "next" | "previous"
  function navigateFrom(element, direction) {
    if (direction === "first-child") {
      return visibleChildren(element)[0] || null;
    }

    if (direction === "parent") {
      const parent = element.parentElement;
      // Children of <body> are the top level, where nothing happens.
      if (!parent || parent === document.body || parent === document.documentElement) return null;
      return parent;
    }

    // Wraps around at the ends.
    const siblings = visibleChildren(element.parentElement);
    const index = siblings.indexOf(element);
    const step = direction === "next" ? 1 : -1;
    return siblings[(index + step + siblings.length) % siblings.length];
  }

  // data-name, else tag + first class, else tag + id, else the tag alone.
  function nameOf(element) {
    if (element.dataset?.name) return element.dataset.name;
    const tag = element.tagName.toLowerCase();
    const firstClass = element.classList[0];
    if (firstClass) return `${tag}.${firstClass}`;
    if (element.id) return `${tag}#${element.id}`;
    return tag;
  }

  // Relative to the page's viewport, which is exactly the preview frame.
  function rectOf(element) {
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }

  // ---- Element ids ----
  // The host can't hold DOM nodes, so elements get ids ("e1", ...). Weak references
  // let removed elements be garbage-collected.
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

  function findElement(id) {
    const element = elementById.get(id)?.deref();
    return element && element.isConnected ? element : null;
  }

  // ---- Identity across re-renders ----
  // A fingerprint records WHERE an element is: the nearest data-key anchor (itself,
  // an ancestor, or a keyed sibling), the child path from it, and a signature at
  // each step. Any doubt means "no longer exists", so the selection never jumps.
  // Text isn't part of it: it can change ("4s ago") while the element stays.
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
    const path = [];
    for (let node = element; node.parentElement && node !== document.body; node = node.parentElement) {
      const signature = signatureOf(node);
      if (node.dataset?.key) return { self: node.dataset.key, signature, path };
      const before = keyedSibling(node, -1);
      const after = keyedSibling(node, +1);
      if (before || after) return { before, after, signature, path };
      path.unshift({ index: indexOf(node), signature });
    }
    return { signature: signatureOf(document.body), path };
  }

  // null if there are none or several: a duplicate key is not trusted.
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

  function resolve(fp) {
    let start;
    if (fp.self) {
      start = uniqueByKey(fp.self);
    } else if (fp.before || fp.after) {
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

  // The same node, or its replacement found by fingerprint (which takes over the id), or null.
  function locateSelected(id) {
    let element = findElement(id);
    if (!element) {
      const fp = fingerprints.get(id);
      element = fp ? resolve(fp) : null;
      if (!element) return null;
      idByElement.set(element, id);
      elementById.set(id, new WeakRef(element));
    }
    fingerprints.set(id, fingerprintOf(element));
    return element;
  }

  // ---- Hover ----
  // elementFromPoint instead of event.target: it also works on disabled controls,
  // SVG, and whatever is on top under a sticky header.
  let pointer = null;
  let rowHoverId = null;
  let hovered = null;
  let lastHoverSent = "null";
  let hoverFrame = 0;

  function elementAt(x, y) {
    const element = document.elementFromPoint(x, y);
    // The page background is never hovered.
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
        ancestors: ancestorIdsOf(hovered),
      };
    }
    const key = JSON.stringify(hover);
    if (key === lastHoverSent) return;
    lastHoverSent = key;
    send("hover", { hover });
  }

  // Re-checked every frame, not only on pointermove, so the outline stays glued when
  // the page scrolls under a still pointer or the element moves.
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

  // relatedTarget is null when the pointer leaves the page or the window.
  document.addEventListener(
    "pointerout",
    (event) => {
      if (event.relatedTarget) return;
      pointer = null;
      scheduleHoverCheck();
    },
    { capture: true },
  );

  // ---- Selection ----
  // Selected elements are measured every frame and changes are sent, so outlines stay glued.
  let selectedIds = [];
  let lastSelectionSent = "";
  let selectionFrame = 0;

  // Scrolled fully out of a scroll area inside the page: still selected, no outline.
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

  // The inspector's Live values. Part of the selection box, so they update with it.
  function liveInfoOf(element, rect) {
    const style = getComputedStyle(element);
    return {
      tag: element.tagName.toLowerCase(),
      elementId: element.id || "",
      classes: [...element.classList].join(" "),
      key: element.dataset?.key || null,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      // Position within the page, not on screen.
      x: Math.round(rect.x + window.scrollX),
      y: Math.round(rect.y + window.scrollY),
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
    const missing = []; // ids whose element no longer exists
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
        ancestors: ancestorIdsOf(element),
        info: liveInfoOf(element, rect),
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

  function sendPick(event) {
    const element = elementAt(event.clientX, event.clientY);
    const id = element ? idOf(element) : null;
    // Fingerprint it now, so a rebuild during the round trip to the host can't lose it.
    if (element) fingerprints.set(id, fingerprintOf(element));
    send("pick", { id, shiftKey: event.shiftKey });
  }

  // ---- Select mode: clicks never reach the page ----
  // Capture phase on window sees each event before the page does. preventDefault stops
  // links, submits and focus; stopImmediatePropagation stops the page's own listeners.
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
        // pointerdown, not click: browsers don't fire click on disabled controls.
        if (type === "pointerdown" && event.button === 0) sendPick(event);
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      { capture: true, passive: false },
    );
  }

  // ---- Keys: shortcuts work right after clicking in a preview ----
  function isTyping(element) {
    if (!element) return false;
    const tag = element.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable;
  }

  window.addEventListener(
    "keydown",
    (event) => {
      if (mode === "interact" && isTyping(event.target)) return;

      send("key", {
        key: event.key,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
      });

      // In Select mode the page must not react to keys either.
      if (mode === "select") {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    { capture: true },
  );

  // ---- Ctrl/Cmd + wheel over this page zooms the board ----
  // The wheel arrives here, not in the host, so pass it on. A plain wheel still scrolls the page.
  window.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      send("zoom-wheel", {
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        x: event.clientX,
        y: event.clientY,
      });
    },
    { passive: false },
  );

  // ---- The page's own errors and unhandled rejections become a "Page error" badge ----
  window.addEventListener("error", (event) => {
    send("page-error", { message: event.message || "Unknown error" });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    send("page-error", { message: reason?.message ?? String(reason) });
  });

  // Handshake: also runs again after the preview navigates to a new page.
  send("ready", {});
})();
