import { useStore } from "./store.js";
import { onAgentMessage } from "./bridge.js";
import { navigateSelection } from "./selectionSync.js";
import { inRegion } from "./regions.js";

// Keys arrive either on the host window or, when a page has focus, forwarded by
// its agent. Both go through handleShortcut.

function isTyping(element) {
  if (!element) return false;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable;
}

// Returns true when the key was a shortcut, so the caller can stop the browser default.
function handleShortcut({ key, shiftKey, ctrlKey, metaKey, altKey }) {
  if (ctrlKey || metaKey || altKey) return false;

  const { mode, setMode, clearSelection } = useStore.getState();
  switch (key.toLowerCase()) {
    case "v":
      setMode("select");
      return true;
    case "i":
      setMode("interact");
      return true;
    case "escape":
      // In Interact mode the selection is hidden and the page may need Escape itself.
      if (mode !== "select") return false;
      clearSelection();
      return true;
    // With nothing selected these return false, so Tab and Enter keep their normal job.
    case "enter":
      return navigateSelection(shiftKey ? "parent" : "first-child");
    case "tab":
      return navigateSelection(shiftKey ? "previous" : "next");
    default:
      return false;
  }
}

export function startKeyboardShortcuts() {
  window.addEventListener(
    "keydown",
    inRegion("board", null, (event) => {
      if (isTyping(event.target)) return;
      if (handleShortcut(event)) event.preventDefault();
    }),
  );

  onAgentMessage("key", (data) => handleShortcut(data), "board");
}
