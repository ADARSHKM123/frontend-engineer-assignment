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

export const useStore = create((set) => ({
  // "select" or "interact" (R1.5)
  mode: "select",

  // Board (R1.1). status is "loading" | "ready" | "error".
  screens: [],
  screensStatus: "loading",
  screensError: null,

  setMode: (mode) => set({ mode }),

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
