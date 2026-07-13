import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retryOnNetworkError } from "./retryOnNetworkError";

describe("retryOnNetworkError", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries transient network failures then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue("token");

    const promise = retryOnNetworkError(fn, {
      maxRetries: 3,
      initialDelayMs: 100,
    });

    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe("token");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry auth errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Not authenticated"));

    await expect(retryOnNetworkError(fn)).rejects.toThrow("Not authenticated");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("rethrows after max retries exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const promise = retryOnNetworkError(fn, {
      maxRetries: 2,
      initialDelayMs: 50,
    });

    const assertion = expect(promise).rejects.toThrow("Failed to fetch");
    await vi.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
