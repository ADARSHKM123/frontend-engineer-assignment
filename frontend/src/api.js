import { API_URL } from "./config.js";

// All API calls go through here: a 5xx or a broken JSON body becomes an Error,
// while a 404 is returned as { notFound: true } because it is not an error.
async function fetchJson(path, { signal, query } = {}) {
  const search = query && Object.keys(query).length ? `?${new URLSearchParams(query)}` : "";
  const res = await fetch(API_URL + path + search, { signal });

  if (res.status === 404) return { notFound: true };
  if (!res.ok) throw new Error(`Request failed: ${res.status} ${res.statusText}`);

  const text = await res.text();

  try {
    return { data: JSON.parse(text) };
  } catch {
    throw new Error("Server returned a malformed response");
  }
}

// A cancelled request is not a failure.
export function isAbortError(error) {
  return error?.name === "AbortError";
}

export async function getScreens({ signal, query } = {}) {
  const { data, notFound } = await fetchJson("/screens", { signal, query });

  const valid =
    !notFound &&
    Array.isArray(data) &&
    data.every((s) => typeof s?.id === "string" && typeof s?.name === "string" && typeof s?.url === "string");

  if (!valid) throw new Error("Server returned an invalid screens list");
  return data;
}

export async function getElementDetails(key, { signal, query } = {}) {
  const { data, notFound } = await fetchJson(`/elements/${encodeURIComponent(key)}`, { signal, query });
  if (notFound) return { notFound: true };

  const fields = ["component", "description", "status", "owner"];
  const valid = data !== null && typeof data === "object" && fields.every((f) => typeof data[f] === "string");
  if (!valid) throw new Error("Server returned invalid element details");
  return { details: data };
}
