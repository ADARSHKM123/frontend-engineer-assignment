import { useStore } from "./store.js";
import { getElementDetails, isAbortError } from "./api.js";
import { report } from "../report.js";

// Details for the one selected element. A new selection aborts the old
// request, so only the latest selection's details can ever show.

let current = null; // { target, controller } of the request whose answer we still want

function singleTarget(state) {
  const { screenId, ids } = state.selection;
  if (ids.length !== 1) return null;
  const box = state.selectionBoxes.find((b) => b.id === ids[0]);
  if (!box?.info) return null;
  return { screenId, id: box.id, key: box.info.key };
}

function sameTarget(a, b) {
  return a?.screenId === b?.screenId && a?.id === b?.id && a?.key === b?.key;
}

async function loadDetails(target) {
  current?.controller.abort();
  current = null;
  const { setDetails } = useStore.getState();

  if (!target) return setDetails({ status: "idle" });
  if (!target.key) return setDetails({ status: "none" });

  const controller = new AbortController();
  const request = { target, controller };
  current = request;
  setDetails({ status: "loading" });

  try {
    const { failDetails, detailsDelayMs } = useStore.getState().dev;
    const query = {};
    if (failDetails) query.fail = 1;
    if (detailsDelayMs) query.latency = detailsDelayMs;
    const result = await getElementDetails(target.key, { signal: controller.signal, query });
    if (current !== request) return;
    if (result.notFound) setDetails({ status: "notFound" });
    else setDetails({ status: "ready", data: result.details });
  } catch (error) {
    // Cancelled because the user moved on: not a failure.
    if (isAbortError(error) || current !== request) return;
    setDetails({ status: "error", error: error.message });
    report(error, { region: "details", screenId: target.screenId, elementKey: target.key });
  }
}

export function retryDetails() {
  loadDetails(current?.target ?? singleTarget(useStore.getState()));
}

export function startDetailsSync() {
  let lastTarget = null;
  useStore.subscribe((state) => {
    const target = singleTarget(state);
    if (sameTarget(target, lastTarget)) return; // boxes re-arrive all the time for the same element
    lastTarget = target;
    loadDetails(target);
  });
}
