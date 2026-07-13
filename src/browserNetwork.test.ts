import { describe, expect, it, vi } from "vitest";
import { subscribeToBrowserNetwork } from "./browserNetwork";

describe("subscribeToBrowserNetwork", () => {
  it("returns noop unsubscribe when window is unavailable", () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error test shim
    delete globalThis.window;

    const unsubscribe = subscribeToBrowserNetwork({
      onOnline: vi.fn(),
      onOffline: vi.fn(),
    });

    expect(() => unsubscribe()).not.toThrow();

    globalThis.window = originalWindow;
  });
});
