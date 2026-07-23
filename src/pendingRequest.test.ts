import { describe, expect, it } from "vitest";
import {
  pickPendingRequest,
  readMessageRequestId,
  shouldDeliverPassive,
  type PendingRequest,
} from "../src/pendingRequest";
import type { EdgeFunctionMessageContext } from "../src/types";

function stubPending(
  requestId?: string,
): PendingRequest<Record<string, unknown>> {
  const ctx: EdgeFunctionMessageContext<Record<string, unknown>> = {
    resolve: () => {},
    reject: () => {},
    closeSocket: () => {},
    clearOverallTimeout: () => {},
    resetOverallTimeout: () => {},
    isResolved: () => false,
  };
  return {
    requestId,
    handler: () => {},
    ctx,
  };
}

describe("readMessageRequestId", () => {
  it("reads top-level requestId", () => {
    expect(
      readMessageRequestId({ type: "tree", data: {}, requestId: "abc" }),
    ).toBe("abc");
  });

  it("returns undefined when absent", () => {
    expect(readMessageRequestId({ type: "repos", data: {} })).toBeUndefined();
  });
});

describe("pickPendingRequest", () => {
  it("single-flight returns the active slot regardless of requestId", () => {
    const active = stubPending();
    const pendingById = new Map<
      string,
      PendingRequest<Record<string, unknown>>
    >();
    pendingById.set("a", stubPending("a"));

    expect(
      pickPendingRequest(
        { type: "complete", data: {}, requestId: "a" },
        { concurrent: false, activeRequest: active, pendingById },
      ),
    ).toBe(active);
  });

  it("concurrent matches requestId in the map", () => {
    const a = stubPending("a");
    const b = stubPending("b");
    const pendingById = new Map([
      ["a", a],
      ["b", b],
    ]);

    expect(
      pickPendingRequest(
        { type: "tree", data: {}, requestId: "b" },
        { concurrent: true, activeRequest: null, pendingById },
      ),
    ).toBe(b);
  });

  it("concurrent returns null for unscoped messages", () => {
    const pendingById = new Map([["a", stubPending("a")]]);
    expect(
      pickPendingRequest(
        { type: "repos", data: { repos: [] } },
        { concurrent: true, activeRequest: null, pendingById },
      ),
    ).toBeNull();
  });

  it("concurrent returns null for unknown requestId", () => {
    const pendingById = new Map([["a", stubPending("a")]]);
    expect(
      pickPendingRequest(
        { type: "complete", data: {}, requestId: "missing" },
        { concurrent: true, activeRequest: null, pendingById },
      ),
    ).toBeNull();
  });
});

describe("shouldDeliverPassive", () => {
  it("single-flight delivers only when no active request", () => {
    expect(
      shouldDeliverPassive({
        concurrent: false,
        messageHasRequestId: false,
        hasActiveRequest: false,
      }),
    ).toBe(true);
    expect(
      shouldDeliverPassive({
        concurrent: false,
        messageHasRequestId: true,
        hasActiveRequest: true,
      }),
    ).toBe(false);
  });

  it("concurrent delivers only unscoped messages", () => {
    expect(
      shouldDeliverPassive({
        concurrent: true,
        messageHasRequestId: false,
        hasActiveRequest: false,
      }),
    ).toBe(true);
    expect(
      shouldDeliverPassive({
        concurrent: true,
        messageHasRequestId: true,
        hasActiveRequest: false,
      }),
    ).toBe(false);
  });
});

describe("concurrent client_message envelope", () => {
  it("includes top-level requestId beside data", () => {
    const requestId = "req-1";
    const payload = { action: "list-tree", repoKey: "SKILL", path: "" };
    const raw = JSON.stringify({
      type: "client_message",
      requestId,
      data: payload,
    });
    expect(JSON.parse(raw)).toEqual({
      type: "client_message",
      requestId: "req-1",
      data: { action: "list-tree", repoKey: "SKILL", path: "" },
    });
  });
});
