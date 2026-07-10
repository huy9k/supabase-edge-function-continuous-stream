import { describe, expect, it } from "vitest";
import { isStreamDisconnectError, STREAM_DISCONNECT_MESSAGE } from "./errors";

describe("isStreamDisconnectError", () => {
  it("matches canonical disconnect message", () => {
    expect(isStreamDisconnectError(new Error(STREAM_DISCONNECT_MESSAGE))).toBe(
      true,
    );
  });

  it("matches known edge-stream disconnect variants", () => {
    expect(isStreamDisconnectError(new Error("WebSocket closed"))).toBe(true);
    expect(
      isStreamDisconnectError(new Error("Connection closed during check")),
    ).toBe(true);
    expect(isStreamDisconnectError(new Error("Request aborted"))).toBe(true);
    expect(
      isStreamDisconnectError(new Error("Chat stream session closed")),
    ).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isStreamDisconnectError(new Error("Unauthorized"))).toBe(false);
    expect(
      isStreamDisconnectError(new Error("WebSocket request timeout")),
    ).toBe(false);
  });
});
