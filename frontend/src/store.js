import { create } from "zustand";
import { getScreens, isAbortError } from "./api.js";
import { report } from "../report.js";
import { emptyTree } from "./layersTree.js";

// The app's single source of truth. State is only changed through the actions below.

let screensRequest = null; // the in-flight /screens request, so a newer load can cancel it

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

export const useStore = create((set, get) => ({
  mode: "select",

  screens: [],
  screensStatus: "loading",
  screensError: null,

  // A board point (bx, by) is drawn at (x + bx * zoom, y + by * zoom).
  camera: { x: 40, y: 60, zoom: MIN_ZOOM },

  // The one hovered element on the board. rect is in the page's own pixels.
  hover: null,

  activeScreenId: null,

  // ids in the order they were selected, so the last one is the most recent.
  selection: { screenId: null, ids: [] },
  selectionBoxes: [],
  selectionGone: false,

  layers: {}, // one tree per preview, see layersTree.js
  layersSearch: "",
  searchResults: {},

  // status: "idle" | "none" | "loading" | "ready" | "notFound" | "error"
  details: { status: "idle", data: null, error: null },

  connections: {},
  pageErrors: {},
  regionErrors: {}, // regions that failed outside rendering, see regions.js

  // Switches for the dev-only menu.
  dev: {
    layersDelayMs: 0,
    crash: null,
    failScreens: false,
    failDetails: false,
    detailsDelayMs: 0,
    brokenPreview: null,
    throwNext: null,
  },

  setMode: (mode) => set({ mode, hover: null }),

  setHover: (screenId, { id, name, rect, ancestors }) =>
    set({ hover: { screenId, id, name, rect, ancestors } }),

  // A click in Select mode; id is null when the page background was clicked.
  pickElement: (screenId, id, shiftKey) =>
    set((s) => {
      const sameScreen = s.selection.screenId === screenId;

      let ids;
      if (id === null) {
        ids = shiftKey && sameScreen ? s.selection.ids : [];
      } else if (shiftKey && sameScreen) {
        ids = s.selection.ids.includes(id)
          ? s.selection.ids.filter((x) => x !== id)
          : [...s.selection.ids, id];
      } else {
        // Plain click, or Shift + click in another preview, replaces the selection.
        ids = [id];
      }

      return {
        activeScreenId: screenId,
        selection: { screenId: ids.length ? screenId : null, ids },
        selectionBoxes: sameScreen ? s.selectionBoxes.filter((b) => ids.includes(b.id)) : [],
        selectionGone: ids.length ? false : s.selectionGone,
      };
    }),

  selectOnly: (screenId, id) =>
    set((s) => ({
      selection: { screenId, ids: [id] },
      selectionBoxes: s.selectionBoxes.filter((b) => b.id === id),
      selectionGone: false,
    })),

  // `change` is a pure function from layersTree.js.
  updateLayers: (screenId, change) =>
    set((s) => ({ layers: { ...s.layers, [screenId]: change(s.layers[screenId] ?? emptyTree()) } })),

  setConnection: (screenId, status) =>
    set((s) => ({ connections: { ...s.connections, [screenId]: status } })),

  setPageError: (screenId, message) =>
    set((s) => ({ pageErrors: { ...s.pageErrors, [screenId]: message } })),

  setDev: (changes) => set((s) => ({ dev: { ...s.dev, ...changes } })),

  setRegionError: (key, error) => set((s) => ({ regionErrors: { ...s.regionErrors, [key]: error } })),

  clearRegionError: (key) =>
    set((s) => {
      const regionErrors = { ...s.regionErrors };
      delete regionErrors[key];
      return { regionErrors };
    }),

  setDetails: (details) => set({ details: { data: null, error: null, ...details } }),

  setLayersSearch: (query) => set({ layersSearch: query }),

  setSearchResults: (screenId, result) =>
    set((s) => ({ searchResults: { ...s.searchResults, [screenId]: result } })),

  clearSearchResults: () => set({ searchResults: {} }),

  resetLayers: (screenId) =>
    set((s) => {
      const layers = { ...s.layers };
      delete layers[screenId];
      return { layers };
    }),

  clearSelection: () => set({ selection: { screenId: null, ids: [] }, selectionBoxes: [] }),

  // `missing` ids no longer exist in the page, so they leave the selection.
  setSelectionBoxes: (screenId, boxes, missing = []) =>
    set((s) => {
      if (s.selection.screenId !== screenId) return {};

      const ids = s.selection.ids.filter((id) => !missing.includes(id));

      const changes = { selectionBoxes: boxes.filter((b) => ids.includes(b.id)) };

      if (ids.length !== s.selection.ids.length) {
        changes.selection = { screenId: ids.length ? screenId : null, ids };
        if (ids.length === 0) changes.selectionGone = true;
      }
      return changes;
    }),

  // Only clear if that preview owns the hover: messages from two previews can arrive out of order.
  clearHover: (screenId) =>
    set((s) => (screenId === undefined || s.hover?.screenId === screenId ? { hover: null } : {})),

  panBy: (dx, dy) =>
    set((s) => ({ camera: { ...s.camera, x: s.camera.x + dx, y: s.camera.y + dy } })),

  // Zoom so the board point under the pointer (px, py) stays under it.
  zoomAt: (px, py, factor) =>
    set((s) => {
      const { x, y, zoom } = s.camera;
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
      const bx = (px - x) / zoom;
      const by = (py - y) / zoom;
      return { camera: { x: px - bx * nextZoom, y: py - by * nextZoom, zoom: nextZoom } };
    }),

  loadScreens: async () => {
    screensRequest?.abort();
    const request = new AbortController();
    screensRequest = request;

    set({ screensStatus: "loading", screensError: null });
    try {
      const query = get().dev.failScreens ? { fail: 1 } : undefined;
      const screens = await getScreens({ signal: request.signal, query });
      if (screensRequest !== request) return;
      set({ screens, screensStatus: "ready" });
    } catch (error) {
      // Cancelled or replaced on purpose: not a failure, so nothing is shown or reported.
      if (isAbortError(error) || screensRequest !== request) return;
      set({ screensStatus: "error", screensError: error.message });
      report(error, { region: "board", screenId: null });
    }
  },

  cancelScreens: () => {
    screensRequest?.abort();
    screensRequest = null;
  },
}));
