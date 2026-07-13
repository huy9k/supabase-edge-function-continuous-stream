import { describe, expect, it } from "vitest";
import {
  isNetworkError,
  isRetriableTransportError,
  isStreamDisconnectError,
  NETWORK_ERROR_MESSAGE,
  STREAM_DISCONNECT_MESSAGE,
} from "./errors";

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

describe("isNetworkError", () => {
  it("matches fetch and network failures", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new Error("NetworkError when attempting to fetch"))).toBe(
      true,
    );
    expect(isNetworkError(new Error("Network request failed"))).toBe(true);
    expect(isNetworkError(new Error("Load failed"))).toBe(true);
  });

  it("excludes auth errors", () => {
    expect(isNetworkError(new Error("Not authenticated"))).toBe(false);
    expect(isNetworkError(new Error("Unauthorized"))).toBe(false);
  });

  it("exports canonical network message constant", () => {
    expect(NETWORK_ERROR_MESSAGE).toBe("Network request failed");
  });
});

describe("isRetriableTransportError", () => {
  it("matches network and disconnect errors", () => {
    expect(isRetriableTransportError(new TypeError("Failed to fetch"))).toBe(
      true,
    );
    expect(
      isRetriableTransportError(new Error(STREAM_DISCONNECT_MESSAGE)),
    ).toBe(true);
  });

  it("returns false for auth errors", () => {
    expect(isRetriableTransportError(new Error("Unauthorized"))).toBe(false);
  });
});
