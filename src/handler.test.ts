import { describe, expect, it, vi } from "vitest";
import { createStandardAiMessageHandler } from "../src/handler";
import type { EdgeFunctionMessageContext } from "../src/types";

function makeCtx<T extends Record<string, unknown>>(): {
  ctx: EdgeFunctionMessageContext<T>;
  resolved: T | null;
  rejected: Error | null;
} {
  let resolved: T | null = null;
  let rejected: Error | null = null;
  const ctx: EdgeFunctionMessageContext<T> = {
    resolve: (value) => {
      resolved = value;
    },
    reject: (err) => {
      rejected = err;
    },
    closeSocket: () => {},
    clearOverallTimeout: () => {},
    resetOverallTimeout: () => {},
    isResolved: () => resolved !== null || rejected !== null,
  };
  return {
    ctx,
    get resolved() {
      return resolved;
    },
    get rejected() {
      return rejected;
    },
  };
}

describe("createStandardAiMessageHandler", () => {
  it("accumulates response_text into reply", () => {
    const bag = makeCtx<{ reply: string }>();
    const handler = createStandardAiMessageHandler<{ reply: string }>();

    handler({ type: "response_text", data: "Hello" }, bag.ctx);

    handler({ type: "complete", data: {} }, bag.ctx);

    expect(bag.resolved).toEqual({ reply: "Hello" });
  });

  it("resolves on complete with merged object data", () => {
    const bag = makeCtx<{ reply: string; id: string }>();
    const handler = createStandardAiMessageHandler<{
      reply: string;
      id: string;
    }>({ reply: "" });

    handler({ type: "complete", data: { id: "abc", reply: "done" } }, bag.ctx);

    expect(bag.resolved).toEqual({ reply: "done", id: "abc" });
  });

  it("rejects on error and calls toUserMessage", () => {
    const bag = makeCtx<Record<string, unknown>>();
    const onServerAction = vi.fn();
    const toUserMessage = vi.fn(() => "Friendly error");
    const handler = createStandardAiMessageHandler(
      {},
      { onServerAction, toUserMessage },
    );

    handler({ type: "error", data: "Unauthorized" }, bag.ctx);

    expect(bag.rejected?.message).toBe("Unauthorized");
    expect(toUserMessage).toHaveBeenCalledWith("Unauthorized");
    expect(onServerAction).toHaveBeenCalledWith("error", "Friendly error");
  });

  it("forwards streaming events via onServerAction", () => {
    const bag = makeCtx<Record<string, unknown>>();
    const onServerAction = vi.fn();
    const handler = createStandardAiMessageHandler({}, { onServerAction });

    handler({ type: "thinking_delta", data: "thinking..." }, bag.ctx);

    expect(onServerAction).toHaveBeenCalledWith(
      "thinking_delta",
      "thinking...",
    );
    expect(bag.resolved).toBeNull();
  });

  it("resolves send before onServerAction on complete", () => {
    const bag = makeCtx<{ reply: string }>();
    const onServerAction = vi.fn();
    const handler = createStandardAiMessageHandler<{ reply: string }>(
      {},
      { onServerAction },
    );

    handler({ type: "complete", data: { reply: "done" } }, bag.ctx);

    expect(bag.resolved).toEqual({ reply: "done" });
    expect(bag.ctx.isResolved()).toBe(true);
    expect(onServerAction).toHaveBeenCalledWith("complete", { reply: "done" });
  });
});
