/** Canonical message when an in-flight send is rejected due to socket teardown */
export const STREAM_DISCONNECT_MESSAGE =
  "WebSocket closed by server or aborted";

/** Canonical message for normalized network failures */
export const NETWORK_ERROR_MESSAGE = "Network request failed";

const STREAM_DISCONNECT_PATTERN =
  /webSocket closed|connection closed|socket closed|request aborted|session closed/i;

const NETWORK_ERROR_PATTERN =
  /failed to fetch|networkerror|network request failed|load failed|network error/i;

const AUTH_ERROR_PATTERN = /not authenticated|unauthorized/i;

/** Extracts a trimmed error message string from unknown thrown values */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.trim();
  if (typeof error === "string") return error.trim();
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string") return message.trim();
  }
  return "";
}

/** True for fetch / connectivity failures that may resolve on retry */
export function isNetworkError(error: unknown): boolean {
  const message = getErrorMessage(error);
  if (!message) return false;
  if (AUTH_ERROR_PATTERN.test(message)) return false;
  return NETWORK_ERROR_PATTERN.test(message);
}

/** True for benign transport teardown errors from the edge-stream client */
export function isStreamDisconnectError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return STREAM_DISCONNECT_PATTERN.test(message);
}

/** True when a send failure is likely transient connectivity, not auth or logic */
export function isRetriableTransportError(error: unknown): boolean {
  return isNetworkError(error) || isStreamDisconnectError(error);
}
