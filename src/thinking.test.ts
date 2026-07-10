import { describe, expect, it } from "vitest";
import {
  isThinkingEvent,
  reduceThinking,
  reduceThinkingReconnect,
} from "./thinking";

describe("isThinkingEvent", () => {
  it("recognizes thinking wire types", () => {
    expect(isThinkingEvent("thinking_paragraph")).toBe(true);
    expect(isThinkingEvent("thinking_delta")).toBe(true);
    expect(isThinkingEvent("thinking_snapshot")).toBe(true);
  });

  it("rejects non-thinking types", () => {
    expect(isThinkingEvent("status")).toBe(false);
    expect(isThinkingEvent("complete")).toBe(false);
  });
});

describe("reduceThinking", () => {
  it("starts a paragraph on empty content", () => {
    expect(reduceThinking("", "thinking_paragraph", "Thinking…")).toBe(
      "Thinking…",
    );
  });

  it("appends paragraphs with blank line separator", () => {
    const first = reduceThinking("", "thinking_paragraph", "Thinking…");
    const second = reduceThinking(first, "thinking_paragraph", "Editing file…");
    expect(second).toBe("Thinking…\n\nEditing file…");
  });

  it("appends deltas to the current paragraph", () => {
    const base = reduceThinking("", "thinking_paragraph", "Thinking…");
    const withDelta = reduceThinking(base, "thinking_delta", " Hmm.");
    expect(withDelta).toBe("Thinking… Hmm.");
  });

  it("replaces all content on snapshot", () => {
    const built = reduceThinking("", "thinking_paragraph", "Thinking…");
    const snap = reduceThinking(
      built,
      "thinking_snapshot",
      "Resumed reasoning",
    );
    expect(snap).toBe("Resumed reasoning");
  });

  it("ignores non-string data", () => {
    expect(reduceThinking("keep", "thinking_delta", null)).toBe("keep");
  });
});

describe("reduceThinkingReconnect", () => {
  it("delegates to reduceThinking when prev is empty", () => {
    expect(
      reduceThinkingReconnect("", "thinking_snapshot", "Fresh start"),
    ).toBe("Fresh start");
  });

  it("appends snapshot as a new paragraph when prev is non-empty", () => {
    const prev = "Thinking…\n\nSearching the web…\n\nSome reasoning";
    expect(
      reduceThinkingReconnect(prev, "thinking_snapshot", "More reasoning"),
    ).toBe(`${prev}\n\nMore reasoning`);
  });

  it("skips snapshot when prev already contains the text", () => {
    const prev = "Thinking…\n\nSearching the web…\n\nSome reasoning";
    expect(
      reduceThinkingReconnect(prev, "thinking_snapshot", "Some reasoning"),
    ).toBe(prev);
  });

  it("still appends paragraphs and deltas mid-turn", () => {
    const prev = "Thinking…\n\nTool activity";
    expect(
      reduceThinkingReconnect(prev, "thinking_paragraph", "Next step…"),
    ).toBe("Thinking…\n\nTool activity\n\nNext step…");
    expect(reduceThinkingReconnect(prev, "thinking_delta", " chunk")).toBe(
      "Thinking…\n\nTool activity chunk",
    );
  });
});
