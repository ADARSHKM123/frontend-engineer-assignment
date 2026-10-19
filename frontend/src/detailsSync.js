import { useStore } from "./store.js";
import { getElementDetails, isAbortError } from "./api.js";
import { report } from "../report.js";

// Inspector Details (R5.1, R5.3): GET /elements/:key for the ONE selected element.
//
// Whenever the single selected element changes, the previous request is aborted
// and a new one starts. Only the latest selection's details can ever be shown:
//   - an aborted request throws AbortError, which we ignore (not a failure, R6.4)
//   - a response is only used if its request is still the current one
// A failure is shown in Details only, reported once, and can be retried (R6.2).

let current = null; // { target, controller } for the request whose answer we still want

// The element Details are about: exactly one selected element whose box (with
// its data-key) has arrived from the page. Otherwise null.
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
  current?.controller.abort(); // the user moved on: cancel the old request
  current = null;
  const { setDetails } = useStore.getState();

  if (!target) return setDetails({ status: "idle" });
  if (!target.key) return setDetails({ status: "none" }); // no data-key → "No details"

  const controller = new AbortController();
  const request = { target, controller };
  current = request;
  setDetails({ status: "loading" });

  try {
    const { failDetails, detailsDelayMs } = useStore.getState().dev; // dev menu (R6.7)
    const query = {};
    if (failDetails) query.fail = 1;
    if (detailsDelayMs) query.latency = detailsDelayMs;
    const result = await getElementDetails(target.key, { signal: controller.signal, query });
    if (current !== request) return; // replaced while waiting: ignore
    if (result.notFound) setDetails({ status: "notFound" }); // a 404 is not an error
    else setDetails({ status: "ready", data: result.details });
  } catch (error) {
    if (isAbortError(error) || current !== request) return; // cancelled on purpose: no error, no report
    setDetails({ status: "error", error: error.message });
    report(error, { region: "details", screenId: target.screenId, elementKey: target.key });
  }
}

// The Retry button: try the same element again. A new failure is reported again (R6.4).
export function retryDetails() {
  loadDetails(current?.target ?? singleTarget(useStore.getState()));
}

export function startDetailsSync() {
  let lastTarget = null;
  useStore.subscribe((state) => {
    const target = singleTarget(state);
    if (sameTarget(target, lastTarget)) return; // same element: boxes re-arrive all the time
    lastTarget = target;
    loadDetails(target);
  });
}
