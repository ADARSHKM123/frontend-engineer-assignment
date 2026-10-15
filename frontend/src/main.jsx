import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { startKeyboardShortcuts } from "./keyboard.js";
import { startModeSync } from "./modeSync.js";
import { startHoverSync } from "./hoverSync.js";
import "./styles.css";

// Global listeners that are not tied to any one component.
startKeyboardShortcuts();
startModeSync();
startHoverSync();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
