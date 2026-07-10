/** Canonical message when an in-flight send is rejected due to socket teardown */
export const STREAM_DISCONNECT_MESSAGE =
  "WebSocket closed by server or aborted";

const STREAM_DISCONNECT_PATTERN =
  /webSocket closed|connection closed|socket closed|request aborted|session closed/i;

/** True for benign transport teardown errors from the edge-stream client */
export function isStreamDisconnectError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return STREAM_DISCONNECT_PATTERN.test(message);
}
