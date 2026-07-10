import { describe, expect, it } from "vitest";

/** Mirrors the wire payload shape used by sendControl */
function buildClientControlPayload(data: Record<string, unknown>): string {
  return JSON.stringify({ type: "client_control", data });
}

describe("sendControl wire payload", () => {
  it("serializes client_control with action and body fields", () => {
    const raw = buildClientControlPayload({
      action: "hub-chat-stop",
      sessionToken: "abc-123",
    });
    expect(JSON.parse(raw)).toEqual({
      type: "client_control",
      data: { action: "hub-chat-stop", sessionToken: "abc-123" },
    });
  });
});
