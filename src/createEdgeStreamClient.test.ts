import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EdgeSocketConnectorDeps } from "./connection";
import { createEdgeStreamClient } from "./createEdgeStreamClient";
import { DEFAULT_EDGE_WORKER_LIMITS } from "./workerLimits";

const { connectEdgeSocketMock } = vi.hoisted(() => ({
  connectEdgeSocketMock: vi.fn(),
}));

vi.mock("./connection", async () => {
  const actual =
    await vi.importActual<typeof import("./connection")>("./connection");
  return {
    ...actual,
    connectEdgeSocket: connectEdgeSocketMock,
  };
});

type FakeSocket = {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

/** Builds a minimal OPEN WebSocket stand-in */
function createFakeSocket(): FakeSocket {
  return {
    readyState: 1, // WebSocket.OPEN
    send: vi.fn(),
    close: vi.fn(),
  };
}

describe("createEdgeStreamClient", () => {
  beforeEach(() => {
    connectEdgeSocketMock.mockReset();
  });

  it("warmups then send resolves on complete without React", async () => {
    let lastDeps: EdgeSocketConnectorDeps<Record<string, unknown>> | null =
      null;

    connectEdgeSocketMock.mockImplementation(
      async (deps: EdgeSocketConnectorDeps<Record<string, unknown>>) => {
        lastDeps = deps;
        const socket = createFakeSocket();
        deps.wsRef.current = socket as unknown as WebSocket;
        deps.socketOpenedAtRef.current = Date.now();
        deps.isWarmupReadyRef.current = true;
        deps.setConnectionState("connected");
        deps.settleWarmupWaiters();
      },
    );

    const createClient = createEdgeStreamClient({
      getAccessToken: async () => "token",
      getSupabaseUrl: () => "https://example.supabase.co",
      workerLimits: {
        ...DEFAULT_EDGE_WORKER_LIMITS,
        overallTimeoutMs: 5_000,
      },
    });

    const stream = createClient<{ action: string }, { ok: boolean }>({
      functionPath: "github-manager",
      concurrent: true,
    });

    const passiveTypes: string[] = [];
    await stream.warmup(
      { action: "warmup" },
      {
        onServerAction: (type) => {
          passiveTypes.push(type);
        },
      },
    );

    expect(stream.getConnectionState()).toBe("connected");
    expect(connectEdgeSocketMock).toHaveBeenCalled();

    const sendPromise = stream.send(
      { action: "list-tree" },
      {
        onServerAction: (type, data) => {
          if (type === "tree") {
            expect(data).toEqual({ entries: [] });
          }
        },
      },
    );

    // Let connect + enqueue settle, then complete the pending request
    await Promise.resolve();
    await Promise.resolve();

    expect(lastDeps).not.toBeNull();
    const pending = [...lastDeps!.pendingRequestsRef.current.values()];
    expect(pending).toHaveLength(1);

    const entry = pending[0]!;
    entry.handler(
      { type: "tree", data: { entries: [] } },
      entry.ctx,
    );
    entry.handler({ type: "complete", data: { ok: true } }, entry.ctx);

    await expect(sendPromise).resolves.toMatchObject({ ok: true });
    expect(stream.getPendingCount()).toBe(0);

    stream.dispose();
  });
});
