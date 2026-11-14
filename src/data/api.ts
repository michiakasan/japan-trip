// Talking to our own server (server/server.ts on Hertz).
//
// The app and the API live on the same website: the app at …/akari/japan-place/ and the
// API at …/akari/japan-place/api/. So "./api/" works both there and in `npm run dev`
// (Vite passes /api/ on to the local server, see vite.config.ts).

const BASE = "./api/";

/** An error answer from the server, e.g. 401 "Enter the trip code first". */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Sends a request and returns the JSON answer. Throws ApiError on an error answer. */
export async function api<T = any>(path: string, options: { method?: string; json?: unknown; body?: Blob } = {}): Promise<T> {
  const headers: Record<string, string> = { "X-Japanchansky": "1" }; // the server only accepts changes with this
  let body: BodyInit | undefined;
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  } else if (options.body) {
    headers["Content-Type"] = options.body.type || "application/octet-stream";
    body = options.body;
  }
  // credentials "same-origin" = send our login cookie along
  const res = await fetch(BASE + path, { method: options.method ?? "GET", headers, body, credentials: "same-origin" });
  const data = (res.headers.get("content-type") ?? "").includes("application/json") ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Server error (${res.status})`);
  return data as T;
}

/**
 * Is there an API at all? "ok" = yes. "missing" = this copy of the app has no server
 * (e.g. opened from a plain file host): then the app keeps data on this device only.
 * Throws if we simply can't reach the internet / the server is down.
 */
export async function checkServer(): Promise<"ok" | "missing"> {
  const res = await fetch(BASE + "health", { credentials: "same-origin" });
  if ([502, 503, 504].includes(res.status)) throw new Error("Server is down");
  const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
  if (res.ok && isJson && (await res.json()).ok) return "ok";
  return "missing";
}

/** Link for one of our photos. The login cookie is sent with it automatically. */
export const photoLink = (photoId: string, size: "full" | "thumb") => `${BASE}photos/${photoId}/${size}`;
