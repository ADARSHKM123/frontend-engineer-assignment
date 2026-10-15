import { useStore } from "./store.js";
import { onAgentMessage } from "./bridge.js";

// Keyboard shortcuts. Keys reach the host in two ways:
//   1. Pressed while the host has focus: a normal keydown on the host window.
//   2. Pressed right after clicking inside a preview: the page has focus, so the
//      keydown happens inside the page; its agent forwards it here (R3.6).
// Both go through handleShortcut, so a shortcut behaves the same either way.

// True when the user is typing into a text field: keys must type, not trigger shortcuts.
function isTyping(element) {
  if (!element) return false;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable;
}

// Returns true when the key was a shortcut (so the caller can stop the browser default).
function handleShortcut({ key, ctrlKey, metaKey, altKey }) {
  if (ctrlKey || metaKey || altKey) return false; // leave Ctrl+C, Cmd+R, etc. alone

  const { setMode } = useStore.getState();
  switch (key.toLowerCase()) {
    case "v":
      setMode("select"); // R1.5
      return true;
    case "i":
      setMode("interact"); // R1.5
      return true;
    default:
      return false;
  }
}

// Start listening. Called once when the app starts.
export function startKeyboardShortcuts() {
  window.addEventListener("keydown", (event) => {
    if (isTyping(event.target)) return;
    if (handleShortcut(event)) event.preventDefault();
  });

  // The agent already skips keys typed into the page's own text fields.
  onAgentMessage("key", (data) => handleShortcut(data));
}
