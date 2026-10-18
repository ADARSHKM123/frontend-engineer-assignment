import { API_URL } from "./config.js";

// Every API call goes through fetchJson, so every call handles failures the same way.
// The backend can fail in two ways (see backend/server.js):
//   1. a 5xx status
//   2. a 200 whose body is broken JSON
// Both become a thrown Error here. A 404 is NOT treated as an error by this helper:
// it returns { notFound: true } so callers can decide (R5.1 says a 404 is not an error).
//
// `signal` comes from an AbortController. When the user moves on, the caller aborts
// the request, fetch throws an AbortError, and callers ignore it (R6.4).
async function fetchJson(path, { signal } = {}) {
  const res = await fetch(API_URL + path, { signal });

  if (res.status === 404) return { notFound: true };
  if (!res.ok) throw new Error(`Request failed: ${res.status} ${res.statusText}`);

  const text = await res.text();

  try {
    return { data: JSON.parse(text) };
  } catch {
    throw new Error("Server returned a malformed response");
  }
}

// True when an error only means "this request was cancelled on purpose".
export function isAbortError(error) {
  return error?.name === "AbortError";
}

// GET /screens -> [{ id, name, url }]
// Also checks the shape, so bad data fails here instead of somewhere in the UI.
export async function getScreens({ signal } = {}) {
  const { data, notFound } = await fetchJson("/screens", { signal });

  const valid =
    !notFound &&
    Array.isArray(data) &&
    data.every((s) => typeof s?.id === "string" && typeof s?.name === "string" && typeof s?.url === "string");

  if (!valid) throw new Error("Server returned an invalid screens list");
  return data;
}

// GET /elements/:key -> { component, description, status, owner }
// Returns { notFound: true } for a 404, which is NOT an error (R5.1).
// Anything else that isn't four strings is bad data and becomes an error (R6.2).
export async function getElementDetails(key, { signal } = {}) {
  const { data, notFound } = await fetchJson(`/elements/${encodeURIComponent(key)}`, { signal });
  if (notFound) return { notFound: true };

  const fields = ["component", "description", "status", "owner"];
  const valid = data !== null && typeof data === "object" && fields.every((f) => typeof data[f] === "string");
  if (!valid) throw new Error("Server returned invalid element details");
  return { details: data };
}
