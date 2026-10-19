import { useStore } from "./store.js";
import { report } from "../report.js";

// React's error boundaries only catch errors thrown while rendering. Handlers,
// timers and messages are wrapped with inRegion(), so every failure, wherever it
// happens, goes through failRegion(): the same region error and a single report.

// Previews and Details belong to one preview each; the other regions are single.
export function regionKey(region, screenId) {
  return (region === "preview" || region === "details") && screenId ? `${region}:${screenId}` : region;
}

export function failRegion(region, screenId, error, context = {}) {
  const state = useStore.getState();

  // The region is gone: change nothing, report nothing.
  if (region === "preview" && !state.screens.some((screen) => screen.id === screenId)) return;

  // Already showing an error: same failure, no second report.
  const key = regionKey(region, screenId);
  if (state.regionErrors[key]) return;

  state.setRegionError(key, error);
  report(error, { region, screenId: screenId ?? null, ...context });
}

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

// Dev menu: the next handler, timer or message in this region throws, once.
function throwIfArmed(region, screenId) {
  const armed = useStore.getState().dev.throwNext;
  if (!armed || armed.region !== region) return;
  if (armed.screenId && armed.screenId !== screenId) return;
  useStore.getState().setDev({ throwNext: null });
  throw new Error(`Simulated error in ${region}, outside rendering`);
}
