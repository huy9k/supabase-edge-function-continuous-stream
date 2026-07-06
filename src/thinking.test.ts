import { describe, expect, it } from "vitest";
import { isThinkingEvent, reduceThinking } from "./thinking";

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
    const second = reduceThinking(
      first,
      "thinking_paragraph",
      "Editing file…",
    );
    expect(second).toBe("Thinking…\n\nEditing file…");
  });

  it("appends deltas to the current paragraph", () => {
    const base = reduceThinking("", "thinking_paragraph", "Thinking…");
    const withDelta = reduceThinking(base, "thinking_delta", " Hmm.");
    expect(withDelta).toBe("Thinking… Hmm.");
  });

  it("replaces all content on snapshot", () => {
    const built = reduceThinking("", "thinking_paragraph", "Thinking…");
    const snap = reduceThinking(built, "thinking_snapshot", "Resumed reasoning");
    expect(snap).toBe("Resumed reasoning");
  });

  it("ignores non-string data", () => {
    expect(reduceThinking("keep", "thinking_delta", null)).toBe("keep");
  });
});
