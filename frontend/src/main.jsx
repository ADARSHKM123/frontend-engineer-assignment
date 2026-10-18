import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { startKeyboardShortcuts } from "./keyboard.js";
import { startModeSync } from "./modeSync.js";
import { startHoverSync } from "./hoverSync.js";
import { startSelectionSync } from "./selectionSync.js";
import { startLayersSync } from "./layersSync.js";
import { startDetailsSync } from "./detailsSync.js";
import { startPreviewSync } from "./previewSync.js";
import "./styles.css";

// Global listeners that are not tied to any one component.
startKeyboardShortcuts();
startModeSync();
startHoverSync();
startSelectionSync();
startLayersSync();
startDetailsSync();
startPreviewSync();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
