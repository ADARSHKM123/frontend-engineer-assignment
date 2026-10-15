import { create } from "zustand";
import { getScreens, isAbortError } from "./api.js";
import { report } from "../report.js";

// The app's shared state lives here, in one Zustand store.
//
// How Zustand works, in short:
//   - `create((set, get) => ({ ...state, ...actions }))` makes a store.
//   - `set({ key: value })` changes state; components using that key re-render.
//   - `get()` reads the current state inside an action.
//   - In a component:  const mode = useStore((s) => s.mode);
//   - Outside React:   useStore.getState().setMode("interact");
//
// Rule: state is only changed through the actions defined below.

// The in-flight /screens request. Kept outside the store because it is not
// something the UI renders; it only lets us cancel the previous request.
let screensRequest = null;

// Zoom limits from R1.3: 25% to 400%.
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

export const useStore = create((set) => ({
  // "select" or "interact" (R1.5)
  mode: "select",

  // Board (R1.1). status is "loading" | "ready" | "error".
  screens: [],
  screensStatus: "loading",
  screensError: null,

  // Board camera (R1.2, R1.3). A board point (bx, by) appears on screen at
  //   x = camera.x + bx * camera.zoom,  y = camera.y + by * camera.zoom
  // measured from the board's top-left corner.
  camera: { x: 40, y: 60, zoom: MIN_ZOOM },

  // The one hovered element on the whole board (R2.2), or null.
  // { screenId, name, rect: { x, y, width, height } }
  // rect is in the page's own pixels, relative to the preview's top-left corner.
  hover: null,

  // Changing mode also clears the hover: Interact mode draws no outlines (R1.5).
  setMode: (mode) => set({ mode, hover: null }),

  setHover: (screenId, { name, rect }) => set({ hover: { screenId, name, rect } }),

  // With a screenId: clear only if that preview owns the hover. This matters when
  // the pointer moves from preview A to B and A's "left" message arrives after B's hover.
  clearHover: (screenId) =>
    set((s) => (screenId === undefined || s.hover?.screenId === screenId ? { hover: null } : {})),

  // Move the board by (dx, dy) screen pixels (R1.2).
  panBy: (dx, dy) =>
    set((s) => ({ camera: { ...s.camera, x: s.camera.x + dx, y: s.camera.y + dy } })),

  // Zoom by `factor`, keeping the board point under the pointer (px, py) still (R1.3).
  zoomAt: (px, py, factor) =>
    set((s) => {
      const { x, y, zoom } = s.camera;
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
      // The board point under the pointer, before zooming...
      const bx = (px - x) / zoom;
      const by = (py - y) / zoom;
      // ...must still be under the pointer after zooming.
      return { camera: { x: px - bx * nextZoom, y: py - by * nextZoom, zoom: nextZoom } };
    }),

  // Loads GET /screens. Also used by the board's Retry button.
  loadScreens: async () => {
    screensRequest?.abort(); // a newer load replaces an older one
    const request = new AbortController();
    screensRequest = request;

    set({ screensStatus: "loading", screensError: null });
    try {
      const screens = await getScreens({ signal: request.signal });
      if (screensRequest !== request) return; // replaced while waiting: ignore
      set({ screens, screensStatus: "ready" });
    } catch (error) {
      // Cancelled or replaced on purpose: not a failure, show nothing, report nothing (R6.4).
      if (isAbortError(error) || screensRequest !== request) return;
      set({ screensStatus: "error", screensError: error.message });
      report(error, { region: "board", screenId: null }); // exactly once per failure (R6.4)
    }
  },

  // Called when the board unmounts, so a late response changes nothing (R6.6).
  cancelScreens: () => {
    screensRequest?.abort();
    screensRequest = null;
  },
}));
