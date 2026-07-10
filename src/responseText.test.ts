import { describe, expect, it } from "vitest";
import { isResponseTextEvent, reduceResponseText } from "./responseText";

describe("isResponseTextEvent", () => {
  it("recognizes response_text", () => {
    expect(isResponseTextEvent("response_text")).toBe(true);
  });

  it("rejects other types", () => {
    expect(isResponseTextEvent("complete")).toBe(false);
    expect(isResponseTextEvent("thinking_delta")).toBe(false);
  });
});

describe("reduceResponseText", () => {
  it("accepts first non-empty snapshot", () => {
    expect(reduceResponseText("", "Hello")).toBe("Hello");
  });

  it("grows with longer snapshots", () => {
    expect(reduceResponseText("Hello", "Hello world")).toBe("Hello world");
  });

  it("keeps prev when reconnect replays a shorter snapshot", () => {
    const prev = "Hello world, this is a long streamed reply.";
    expect(reduceResponseText(prev, "Hello world")).toBe(prev);
  });

  it("ignores empty next", () => {
    expect(reduceResponseText("Keep me", "")).toBe("Keep me");
    expect(reduceResponseText("Keep me", "   ")).toBe("Keep me");
  });
});
