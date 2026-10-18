import { useEffect, useLayoutEffect, useRef } from "react";
import { useStore } from "../store.js";
import { ROOT, visibleRows } from "../layersTree.js";
import {
  loadChildren,
  toggleRow,
  clickRow,
  panelArrowKey,
  saveLayersScroll,
  savedLayersScroll,
} from "../layersSync.js";
import { hoverRow } from "../hoverSync.js";

const NONE = [];

// The layers panel (R4): the element tree of the active preview.
// It only draws what's in the store; loading is done by layersSync.js.
export default function LayersPanel() {
  const screenId = useStore((s) => s.activeScreenId);
  const tree = useStore((s) => (s.activeScreenId ? s.layers[s.activeScreenId] : null));
  // Hover and selection of THIS preview only (they may belong to another preview).
  const hover = useStore((s) => (s.hover && s.hover.screenId === s.activeScreenId ? s.hover : null));
  const selectedIds = useStore((s) =>
    s.selection.screenId && s.selection.screenId === s.activeScreenId ? s.selection.ids : NONE,
  );

  const panelRef = useRef(null);
  const hasRows = Boolean(tree?.nodes[ROOT].childIds);

  // Switching the active preview restores that preview's scroll position (R4.9).
  // Its open rows come back by themselves: each preview has its own tree in the store.
  // useLayoutEffect runs before the browser paints, so there's no visible jump.
  useLayoutEffect(() => {
    if (hasRows && panelRef.current) panelRef.current.scrollTop = savedLayersScroll(screenId);
  }, [screenId, hasRows]);

  useScrollAnchor(panelRef, screenId);
  useScrollToSelectedRow(panelRef, selectedIds[selectedIds.length - 1]);

  if (!screenId || !tree) {
    return (
      <section className="layers">
        <p className="layers-message">Click something in a preview</p>
      </section>
    );
  }

  // The top level is the panel's own region: its loading state and error fill the panel.
  const root = tree.nodes[ROOT];
  if (root.status === "error") {
    return (
      <section className="layers">
        <div className="layers-message" role="alert">
          <p>Couldn't load the layers.</p>
          <button onClick={() => loadChildren(screenId, ROOT)}>Retry</button>
        </div>
      </section>
    );
  }
  if (root.childIds === null) {
    return (
      <section className="layers">
        <p className="layers-message">Loading layers…</p>
      </section>
    );
  }

  const rows = visibleRows(tree);
  const hoveredRowId = hover ? findVisibleRow(rows, hover) : null;

  // Arrow keys while the panel has focus (R4.8). preventDefault stops the arrows
  // from also scrolling the panel. Other keys (Enter, Tab, V, I, Escape…) carry
  // on to the app-wide shortcuts in keyboard.js.
  function onKeyDown(event) {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    panelArrowKey(screenId, event.key);
  }

  return (
    <section
      className="layers"
      ref={panelRef}
      tabIndex={0} // focusable, so it can receive keys; clicking a row focuses it too
      aria-label="Layers"
      onKeyDown={onKeyDown}
      onScroll={(event) => saveLayersScroll(screenId, event.currentTarget.scrollTop)}
    >
      <div className="layers-tree" role="tree" aria-multiselectable="true">
        {rows.map(({ id, depth }) => (
          <LayerRow
            key={id}
            screenId={screenId}
            node={tree.nodes[id]}
            depth={depth}
            expanded={Boolean(tree.expanded[id])}
            hovered={id === hoveredRowId}
            selected={selectedIds.includes(id)}
          />
        ))}
      </div>
    </section>
  );
}

// The row to highlight for a hovered element (R4.4): its own row if it's visible,
// otherwise the nearest visible ancestor (inside a collapsed parent). Hover never
// opens anything.
function findVisibleRow(rows, hover) {
  const visible = new Set(rows.map((row) => row.id));
  const candidates = [...(hover.ancestors ?? []), hover.id].reverse(); // the element first, then upwards
  return candidates.find((id) => visible.has(id)) ?? null;
}

// "Rows the user is looking at don't jump" (R4.10). When the page adds or removes
// rows ABOVE what the user is looking at, everything below would shift. So:
//   1. While rendering (the DOM still shows the OLD rows), note the first visible
//      row (the "anchor") and how far it is from the top of the panel.
//   2. After React updates the DOM, if the anchor row moved, scroll by the same
//      amount to put it back.
// Measuring during render (not on scroll events) means the snapshot is always
// exactly what the user saw just before the change. (The CSS sets
// overflow-anchor: none so the browser doesn't also try.)
function useScrollAnchor(panelRef, screenId) {
  const panel = panelRef.current;
  let snapshot = null; // { id, offset } of the first visible row, before this render
  if (panel) {
    for (const row of panel.querySelectorAll(".layer-row")) {
      if (row.offsetTop + row.offsetHeight > panel.scrollTop) {
        snapshot = { id: row.dataset.rowId, offset: row.offsetTop - panel.scrollTop };
        break;
      }
    }
  }
  // Remember which preview the snapshot belongs to: row ids from different pages
  // can look alike ("e5"), so we never anchor across a switch of preview.
  const lastScreenId = useRef(screenId);
  const sameScreen = lastScreenId.current === screenId;

  useLayoutEffect(() => {
    lastScreenId.current = screenId;
    if (!sameScreen || !snapshot || !panelRef.current) return;
    const row = panelRef.current.querySelector(`[data-row-id="${snapshot.id}"]`);
    if (row) panelRef.current.scrollTop = row.offsetTop - snapshot.offset; // removed? leave the scroll as is
  });
}

// When a new element is selected, scroll the panel to show its row (R4.5).
// Its row may not exist yet (ancestors still loading), so we keep trying on every
// render until it appears, and then stop for that element.
function useScrollToSelectedRow(panelRef, targetId) {
  const scrolledTo = useRef(null);
  useEffect(() => {
    if (!targetId) {
      scrolledTo.current = null;
      return;
    }
    if (scrolledTo.current === targetId) return;
    const panel = panelRef.current;
    const row = panel?.querySelector(`[data-row-id="${targetId}"]`);
    if (!row) return; // not shown yet: try again on the next render
    scrolledTo.current = targetId;

    // Scroll only the panel (never the page or the board), and only if needed.
    if (row.offsetTop < panel.scrollTop) {
      panel.scrollTop = row.offsetTop;
    } else if (row.offsetTop + row.offsetHeight > panel.scrollTop + panel.clientHeight) {
      panel.scrollTop = row.offsetTop + row.offsetHeight - panel.clientHeight;
    }
  });
}

// One row: indentation, chevron (if it has children), name, and its loading state (R4.2, R4.3).
// Hovering it outlines the element (R4.4); clicking selects it (R4.5, R4.7).
function LayerRow({ screenId, node, depth, expanded, hovered, selected }) {
  const className = ["layer-row", hovered && "is-hovered", selected && "is-selected"]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={className}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={node.hasChildren ? expanded : undefined}
      data-row-id={node.id}
      style={{ paddingLeft: 6 + depth * 14 }}
      onMouseEnter={() => hoverRow(screenId, node.id)}
      onMouseLeave={() => hoverRow(screenId, null)}
      onClick={(event) => clickRow(screenId, node.id, event.shiftKey)}
    >
      {node.hasChildren ? (
        <button
          className="layer-chevron"
          aria-label={expanded ? "Collapse" : "Expand"}
          onClick={(event) => {
            event.stopPropagation(); // opening a row doesn't select it
            toggleRow(screenId, node.id);
          }}
        >
          {expanded ? "▾" : "▸"}
        </button>
      ) : (
        <span className="layer-chevron" />
      )}

      <span className="layer-name">{node.name}</span>

      {/* Only an open row shows its loading state or error. */}
      {expanded && node.status === "loading" && <span className="layer-status">Loading…</span>}
      {expanded && node.status === "error" && (
        <span className="layer-status layer-error">
          Couldn't load
          <button
            onClick={(event) => {
              event.stopPropagation(); // retrying doesn't select the row
              loadChildren(screenId, node.id);
            }}
          >
            Retry
          </button>
        </span>
      )}
    </div>
  );
}
