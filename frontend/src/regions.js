import { useStore } from "./store.js";
import { report } from "../report.js";

// Failure regions (R6.1, R6.5).
//
// React's error boundaries only catch errors thrown WHILE RENDERING. An error
// thrown in a click or key handler, a timer, a message from a page, or code
// handling a response skips them. So every such entry point is wrapped with
// inRegion(), and every failure, wherever it happened, goes through failRegion():
// the same region error, and the same single report.
//
//   region    "board" | "preview" | "layers" | "inspector" | "details"
//   screenId  the preview the region belongs to (previews, details), or null

// How a region is named in store.regionErrors. Previews and Details belong to one
// preview each ("preview:scr-02"); the board, the layers panel and the inspector
// are one region each, whichever preview the error came from.
export function regionKey(region, screenId) {
  return (region === "preview" || region === "details") && screenId ? `${region}:${screenId}` : region;
}

// The one way a region fails. RegionBoundary then shows its error and Retry.
export function failRegion(region, screenId, error, context = {}) {
  const state = useStore.getState();

  // The region is gone (e.g. its preview was removed): change nothing, report nothing (R6.6).
  if (region === "preview" && !state.screens.some((screen) => screen.id === screenId)) return;

  // Already showing an error: it's the same failure, so no second report.
  const key = regionKey(region, screenId);
  if (state.regionErrors[key]) return;

  state.setRegionError(key, error);
  report(error, { region, screenId: screenId ?? null, ...context });
}

// Wrap a function so an error thrown inside it fails `region` instead of being
// lost. Works for click/key handlers, timers and message handlers alike, and
// also catches the rejection if the function is async.
export function inRegion(region, screenId, fn) {
  return (...args) => {
    try {
      throwIfArmed(region, screenId);
      const result = fn(...args);
      if (result && typeof result.then === "function") {
        result.catch((error) => failRegion(region, screenId, error));
      }
      return result;
    } catch (error) {
      failRegion(region, screenId, error);
    }
  };
}

// Dev menu (R6.7): "the next handler, timer or message in this region throws".
// It throws from inside the wrapper, so it goes through exactly the same path
// as a real error would.
function throwIfArmed(region, screenId) {
  const armed = useStore.getState().dev.throwNext;
  if (!armed || armed.region !== region) return;
  if (armed.screenId && armed.screenId !== screenId) return;
  useStore.getState().setDev({ throwNext: null }); // only once
  throw new Error(`Simulated error in ${region}, outside rendering`);
}
