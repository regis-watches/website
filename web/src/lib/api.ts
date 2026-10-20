import { ApiError } from "./errors";

export { ApiError };

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export async function api<T = unknown>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", "X-Requested-With": "regis" };
  let payload: BodyInit | undefined;
  if (body instanceof Blob) {
    payload = body;
    headers["Content-Type"] = body.type;
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "We could not reach the server. Check your connection and try again.");
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) {
    const message =
      typeof data?.detail === "string"
        ? data.detail
        : res.status === 429
          ? "Too many attempts. Please wait a moment and try again."
          : "Something went wrong. Please try again.";
    throw new ApiError(res.status, message, data?.fields ?? {});
  }
  return data as T;
}

/** Report unexpected front-end errors without ever sending personal data. */
export function reportError(message: string, where = ""): void {
  try {
    void fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "regis" },
      body: JSON.stringify({ message: message.slice(0, 300), where: where.slice(0, 200) }),
      keepalive: true,
    });
  } catch {
    /* never let error reporting cause an error */
  }
}
