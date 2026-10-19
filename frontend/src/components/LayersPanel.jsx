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
  setSearchQuery,
  retrySearch,
} from "../layersSync.js";
import { hoverRow } from "../hoverSync.js";
import { inRegion } from "../regions.js";

const NONE = [];

// Error boundaries don't catch errors in event handlers, so every handler here is wrapped.
const inLayers = (screenId, handler) => inRegion("layers", screenId, handler);

// Only draws what's in the store; loading and keys are handled in layersSync.js.
export default function LayersPanel() {
  const screenId = useStore((s) => s.activeScreenId);
  const tree = useStore((s) => (s.activeScreenId ? s.layers[s.activeScreenId] : null));
  const hover = useStore((s) => (s.hover && s.hover.screenId === s.activeScreenId ? s.hover : null));
  const selectedIds = useStore((s) =>
    s.selection.screenId && s.selection.screenId === s.activeScreenId ? s.selection.ids : NONE,
  );
  const query = useStore((s) => s.layersSearch);
  const results = useStore((s) => (s.activeScreenId ? s.searchResults[s.activeScreenId] : null));
  const searching = query !== "";

  const panelRef = useRef(null);
  const hasRows = Boolean(tree?.nodes[ROOT].childIds);

  // Restore the preview's scroll position before the browser paints, so nothing jumps.
  useLayoutEffect(() => {
    if (!panelRef.current || !hasRows) return;
    panelRef.current.scrollTop = searching ? 0 : savedLayersScroll(screenId);
  }, [screenId, hasRows, searching]);

  useScrollAnchor(panelRef, screenId);
  useScrollToSelectedRow(panelRef, selectedIds[selectedIds.length - 1]);

  if (!screenId || !tree) {
    return (
      <section className="layers">
        <p className="layers-message">Click something in a preview</p>
      </section>
    );
  }

  const root = tree.nodes[ROOT];
  if (root.status === "error") {
    return (
      <section className="layers">
        <div className="layers-message" role="alert">
          <p>Couldn't load the layers.</p>
          <button onClick={inLayers(screenId, () => loadChildren(screenId, ROOT))}>Retry</button>
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

  // Search results replace the tree on screen; the tree itself is left untouched.
  const rows = searching ? (results?.rows ?? []) : visibleRows(tree);
  const hoveredRowId = hover ? findVisibleRow(rows, hover) : null;

  // Arrow keys. Keys typed in the search box are left alone.
  function onKeyDown(event) {
    if (event.target.tagName === "INPUT") return;
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    panelArrowKey(screenId, event.key);
  }

  return (
    <section
      className="layers"
      ref={panelRef}
      tabIndex={0}
      aria-label="Layers"
      onKeyDown={inLayers(screenId, onKeyDown)}
      onScroll={inLayers(screenId, (event) => !searching && saveLayersScroll(screenId, event.currentTarget.scrollTop))}
    >
      <div className="layers-search">
        <input
          type="search"
          placeholder="Search layers"
          aria-label="Search layers"
          value={query}
          onChange={inLayers(screenId, (event) => setSearchQuery(event.target.value))}
        />
      </div>

      {searching && <SearchStatus screenId={screenId} query={query} results={results} />}

      <div className="layers-tree" role="tree" aria-multiselectable="true">
        {rows.map((row) => (
          <LayerRow
            key={row.id}
            screenId={screenId}
            node={searching ? row : tree.nodes[row.id]}
            depth={row.depth}
            expanded={!searching && Boolean(tree.expanded[row.id])}
            hovered={row.id === hoveredRowId}
            selected={selectedIds.includes(row.id)}
            inSearch={searching}
            dimmed={searching && !row.match}
          />
        ))}
      </div>
    </section>
  );
}

function SearchStatus({ screenId, query, results }) {
  if (results?.status === "error") {
    return (
      <div className="layers-message" role="alert">
        <p>Couldn't search this preview.</p>
        <button onClick={inLayers(screenId, () => retrySearch(screenId))}>Retry</button>
      </div>
    );
  }
  if (!results || (results.status === "loading" && results.rows.length === 0)) {
    return <p className="layers-message">Searching…</p>;
  }
  if (results.status === "ready" && results.rows.length === 0) {
    return <p className="layers-message">No layers match “{query}”</p>;
  }
  return null;
}

// The hovered element's row, or its nearest visible ancestor if it's inside a closed row.
function findVisibleRow(rows, hover) {
  const visible = new Set(rows.map((row) => row.id));
  const candidates = [...(hover.ancestors ?? []), hover.id].reverse();
  return candidates.find((id) => visible.has(id)) ?? null;
}

// Rows the user is looking at don't jump: note the first visible row while
// rendering (the DOM still shows the old rows), then scroll it back into place after the update.
function useScrollAnchor(panelRef, screenId) {
  const panel = panelRef.current;
  let snapshot = null;
  if (panel) {
    for (const row of panel.querySelectorAll(".layer-row")) {
      if (row.offsetTop + row.offsetHeight > panel.scrollTop) {
        snapshot = { id: row.dataset.rowId, offset: row.offsetTop - panel.scrollTop };
        break;
      }
    }
  }
  // Row ids from different pages can look alike ("e5"), so never anchor across previews.
  const lastScreenId = useRef(screenId);
  const sameScreen = lastScreenId.current === screenId;

  useLayoutEffect(() => {
    lastScreenId.current = screenId;
    if (!sameScreen || !snapshot || !panelRef.current) return;
    const row = panelRef.current.querySelector(`[data-row-id="${snapshot.id}"]`);
    if (row) panelRef.current.scrollTop = row.offsetTop - snapshot.offset;
  });
}

// Scroll the panel to a newly selected row, retrying each render until the row exists.
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
    if (!row) return;
    scrolledTo.current = targetId;

    // The search box is sticky, so the row must sit below it to be seen.
    const searchBoxHeight = panel.querySelector(".layers-search")?.offsetHeight ?? 0;
    if (row.offsetTop - searchBoxHeight < panel.scrollTop) {
      panel.scrollTop = row.offsetTop - searchBoxHeight;
    } else if (row.offsetTop + row.offsetHeight > panel.scrollTop + panel.clientHeight) {
      panel.scrollTop = row.offsetTop + row.offsetHeight - panel.clientHeight;
    }
  });
}

// In search results rows can't be opened or closed; dimmed rows are ancestors, not matches.
function LayerRow({ screenId, node, depth, expanded, hovered, selected, inSearch, dimmed }) {
  const className = ["layer-row", hovered && "is-hovered", selected && "is-selected", dimmed && "is-dimmed"]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={className}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={node.hasChildren && !inSearch ? expanded : undefined}
      data-row-id={node.id}
      style={{ paddingLeft: 6 + depth * 14 }}
      onMouseEnter={inLayers(screenId, () => hoverRow(screenId, node.id))}
      onMouseLeave={inLayers(screenId, () => hoverRow(screenId, null))}
      onClick={inLayers(screenId, (event) => clickRow(screenId, node.id, event.shiftKey))}
    >
      {node.hasChildren && !inSearch ? (
        <button
          className="layer-chevron"
          aria-label={expanded ? "Collapse" : "Expand"}
          onClick={inLayers(screenId, (event) => {
            event.stopPropagation(); // opening a row doesn't select it
            toggleRow(screenId, node.id);
          })}
        >
          {expanded ? "▾" : "▸"}
        </button>
      ) : (
        <span className="layer-chevron" />
      )}

      <span className="layer-name">{node.name}</span>

      {expanded && node.status === "loading" && <span className="layer-status">Loading…</span>}
      {expanded && node.status === "error" && (
        <span className="layer-status layer-error">
          Couldn't load
          <button
            onClick={inLayers(screenId, (event) => {
              event.stopPropagation(); // retrying doesn't select the row
              loadChildren(screenId, node.id);
            })}
          >
            Retry
          </button>
        </span>
      )}
    </div>
  );
}
