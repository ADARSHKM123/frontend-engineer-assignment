// The layers tree of one preview, and small functions that change it.
// These are "pure" functions: they take a tree and return a NEW tree, and never
// touch messages, React or the store. That makes them easy to read and test.
//
// A tree looks like this:
//   {
//     nodes: {
//       root: { id: "root", childIds: ["e1", "e2"], status: "loaded", hasChildren: true },
//       e1:   { id: "e1", name: "Top nav", key: null, hasChildren: true,
//               childIds: null,      // null = children never loaded
//               status: "idle" },    // "idle" | "loading" | "loaded" | "error"
//       ...
//     },
//     expanded: { root: true, e1: true },   // which rows are open
//   }
//
// "root" is not a real element: it stands for <body>, whose children are the
// top-level rows (R4.2). Treating it like any other node means the top level
// loads, fails and retries with exactly the same code as every other row.

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

// The children of `parentId` arrived. They REPLACE whatever was there, so a
// late or repeated answer can never add duplicates (R4.3).
export function setChildren(tree, parentId, children) {
  const nodes = { ...tree.nodes };
  for (const child of children) {
    // Keep what we already know about a row (e.g. its own loaded children).
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

// The rows to draw, top to bottom: every child of an expanded row, with its depth.
// [{ id: "e1", depth: 0 }, { id: "e5", depth: 1 }, ...]
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
