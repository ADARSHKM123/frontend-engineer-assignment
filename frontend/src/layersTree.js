// Pure functions on one preview's layers tree: each takes a tree and returns a new one.
// A tree is { nodes: { [id]: { id, name, key, hasChildren, childIds, status } }, expanded: { [id]: true } }.
// childIds is null until loaded; status is "idle" | "loading" | "loaded" | "error".

// "root" stands for <body>, so the top level loads and retries like any other row.
export const ROOT = "root";

export function emptyTree() {
  return {
    nodes: { [ROOT]: { id: ROOT, childIds: null, status: "idle", hasChildren: true } },
    expanded: { [ROOT]: true },
  };
}

function updateNode(tree, id, changes) {
  return { ...tree, nodes: { ...tree.nodes, [id]: { ...tree.nodes[id], ...changes } } };
}

export function setStatus(tree, id, status) {
  return updateNode(tree, id, { status });
}

// Children REPLACE what was there, so a late or repeated answer never adds duplicates.
export function setChildren(tree, parentId, children) {
  const nodes = { ...tree.nodes };
  for (const child of children) {
    nodes[child.id] = {
      childIds: null,
      status: "idle",
      ...nodes[child.id],
      id: child.id,
      name: child.name,
      key: child.key,
      hasChildren: child.hasChildren,
    };
  }
  nodes[parentId] = { ...nodes[parentId], childIds: children.map((c) => c.id), status: "loaded" };
  return { ...tree, nodes };
}

export function setExpanded(tree, id, isExpanded) {
  return { ...tree, expanded: { ...tree.expanded, [id]: isExpanded } };
}

// A row's parent is the nearest row above it that is one level less deep.
export function parentRowOf(rows, index) {
  for (let i = index - 1; i >= 0; i--) {
    if (rows[i].depth === rows[index].depth - 1) return rows[i];
  }
  return null;
}

// The rows to draw, top to bottom, as [{ id, depth }].
export function visibleRows(tree) {
  const rows = [];
  function addChildrenOf(id, depth) {
    for (const childId of tree.nodes[id].childIds ?? []) {
      rows.push({ id: childId, depth });
      if (tree.expanded[childId]) addChildrenOf(childId, depth + 1);
    }
  }
  addChildrenOf(ROOT, 0);
  return rows;
}
