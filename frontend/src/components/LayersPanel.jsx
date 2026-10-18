import { useStore } from "../store.js";
import { ROOT, visibleRows } from "../layersTree.js";
import { loadChildren, toggleRow } from "../layersSync.js";

// The layers panel (R4.1-R4.3): the element tree of the active preview.
// It only draws what's in the store; loading is done by layersSync.js.
export default function LayersPanel() {
  const screenId = useStore((s) => s.activeScreenId);
  const tree = useStore((s) => (s.activeScreenId ? s.layers[s.activeScreenId] : null));

  if (!screenId || !tree) {
    return <p className="layers-message">Click something in a preview</p>;
  }

  // The top level is the panel's own region: its loading state and error fill the panel.
  const root = tree.nodes[ROOT];
  if (root.status === "error") {
    return (
      <div className="layers-message" role="alert">
        <p>Couldn't load the layers.</p>
        <button onClick={() => loadChildren(screenId, ROOT)}>Retry</button>
      </div>
    );
  }
  if (root.childIds === null) {
    return <p className="layers-message">Loading layers…</p>;
  }

  return (
    <div className="layers-tree" role="tree">
      {visibleRows(tree).map(({ id, depth }) => (
        <LayerRow
          key={id}
          screenId={screenId}
          node={tree.nodes[id]}
          depth={depth}
          expanded={Boolean(tree.expanded[id])}
        />
      ))}
    </div>
  );
}

// One row: indentation, chevron (if it has children), name, and its loading state (R4.2, R4.3).
function LayerRow({ screenId, node, depth, expanded }) {
  return (
    <div
      className="layer-row"
      role="treeitem"
      aria-expanded={node.hasChildren ? expanded : undefined}
      style={{ paddingLeft: 6 + depth * 14 }}
    >
      {node.hasChildren ? (
        <button
          className="layer-chevron"
          aria-label={expanded ? "Collapse" : "Expand"}
          onClick={() => toggleRow(screenId, node.id)}
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
          <button onClick={() => loadChildren(screenId, node.id)}>Retry</button>
        </span>
      )}
    </div>
  );
}
