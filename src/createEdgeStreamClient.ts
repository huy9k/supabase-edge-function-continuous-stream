import { subscribeToBrowserNetwork } from "./browserNetwork";
import { connectEdgeSocket } from "./connection";
import { createStandardAiMessageHandler } from "./handler";
import { isRetriableTransportError } from "./errors";
import type { PendingRequest } from "./pendingRequest";
import type {
  ConnectionState,
  EdgeFunctionMessageContext,
  EdgeStreamConfig,
  Ref,
  SendControlOptions,
  StartStreamOptions,
  WarmupOptions,
} from "./types";
import type { EdgeWorkerLimits } from "./workerLimits";

export type EdgeStreamCoreDeps = {
  getAccessToken: () => Promise<string>;
  getSupabaseUrl: () => string;
  workerLimits: EdgeWorkerLimits;
  toUserMessage?: (error: unknown) => string | null;
  invalidateTags?: (
    tags: Array<string | { type: string; id?: string | number }>,
  ) => void;
  onConnectionStateChange?: (state: ConnectionState) => void;
  reconnectOnBrowserOnline?: boolean;
};

type TrackedRequest<
  TPayload,
  TResponse extends Record<string, unknown>,
> = PendingRequest<TResponse> & {
  payload: TPayload;
  options: StartStreamOptions<TResponse>;
  resolve: (val: TResponse) => void;
  reject: (err: Error) => void;
  overallTimeout: ReturnType<typeof setTimeout> | null;
};

export type EdgeStreamClient<
  TPayload,
  TResponse extends Record<string, unknown>,
> = {
  warmup: (payload: TPayload, options?: WarmupOptions) => Promise<void>;
  send: (
    payload: TPayload,
    options: StartStreamOptions<TResponse>,
  ) => Promise<TResponse>;
  sendControl: (
    data: Record<string, unknown>,
    options?: SendControlOptions<TPayload>,
  ) => Promise<void>;
  /** Registers a fallback warmup payload resolver for sendControl auto-warm */
  setWarmupPayloadProvider: (provider: (() => TPayload | null) | null) => void;
  /** Force-closes and reopens the socket for mid-turn worker reclaim */
  reconnect: () => Promise<void>;
  abort: () => void;
  getConnectionState: () => ConnectionState;
  subscribeConnectionState: (
    listener: (state: ConnectionState) => void,
  ) => () => void;
  getPendingCount: () => number;
  subscribePendingCount: (listener: (count: number) => void) => () => void;
  dispose: () => void;
};

type CreateClient = <TPayload, TResponse extends Record<string, unknown>>(
  config: EdgeStreamConfig,
) => EdgeStreamClient<TPayload, TResponse>;

/** Factory for a non-React WebSocket stream client wired to a host app */
export function createEdgeStreamClient(deps: EdgeStreamCoreDeps): CreateClient {
  const {
    getAccessToken,
    getSupabaseUrl,
    workerLimits,
    toUserMessage,
    invalidateTags,
    onConnectionStateChange,
    reconnectOnBrowserOnline = false,
  } = deps;

  const { edgeWorkerTtlMs, edgeRotateThresholdMs, overallTimeoutMs } =
    workerLimits;

  return function createClient<
    TPayload,
    TResponse extends Record<string, unknown>,
  >(config: EdgeStreamConfig): EdgeStreamClient<TPayload, TResponse> {
    const concurrent = config.concurrent === true;

    const wsRef: Ref<WebSocket | null> = { current: null };
    const isExplicitDisconnectRef: Ref<boolean> = { current: false };
    const isConnectingRef: Ref<boolean> = { current: false };
    const lastWarmupPayloadRef: Ref<TPayload | null> = { current: null };
    const warmupPayloadProviderRef: Ref<(() => TPayload | null) | null> = {
      current: null,
    };
    const isWarmupReadyRef: Ref<boolean> = { current: false };
    const warmupWaitersRef: Ref<
      Array<{ resolve: () => void; reject: (err: Error) => void }>
    > = { current: [] };
    const retryCountRef: Ref<number> = { current: 0 };
    const passiveOnServerActionRef: Ref<
      ((type: string, data: unknown) => void) | null
    > = { current: null };
    const socketOpenedAtRef: Ref<number | null> = { current: null };
    const activeRequestRef: Ref<TrackedRequest<TPayload, TResponse> | null> = {
      current: null,
    };
    const pendingRequestsRef: Ref<
      Map<string, TrackedRequest<TPayload, TResponse>>
    > = { current: new Map() };
    const pendingCountRef: Ref<number> = { current: 0 };

    let connectionState: ConnectionState = "disconnected";
    const connectionListeners = new Set<(state: ConnectionState) => void>();
    const pendingListeners = new Set<(count: number) => void>();
    let unsubscribeBrowserNetwork: (() => void) | null = null;
    let disposed = false;

    /** Notifies connection subscribers and optional dep callback */
    function setConnectionState(state: ConnectionState) {
      connectionState = state;
      onConnectionStateChange?.(state);
      for (const listener of connectionListeners) listener(state);
    }

    /** Notifies pending-count subscribers */
    function syncPendingCount() {
      const count = pendingCountRef.current;
      for (const listener of pendingListeners) listener(count);
    }

    /** Resolves or rejects all waiters blocked on warmup ready */
    function settleWarmupWaiters(warmupError?: Error) {
      const waiters = warmupWaitersRef.current;
      warmupWaitersRef.current = [];
      if (warmupError) {
        waiters.forEach((w) => w.reject(warmupError));
        return;
      }
      waiters.forEach((w) => w.resolve());
    }

    /** Waits until the server marks warmup ready */
    function waitForWarmupReady() {
      if (isWarmupReadyRef.current) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        warmupWaitersRef.current.push({ resolve, reject });
      });
    }

    /** Sends the cached warmup payload on an open socket */
    function sendWarmupPayload() {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      if (!lastWarmupPayloadRef.current) return;
      isWarmupReadyRef.current = false;
      wsRef.current.send(
        JSON.stringify({
          type: "client_warmup",
          data: lastWarmupPayloadRef.current,
        }),
      );
    }

    /**
     * Best-effort socket close. Detaches handlers first so this socket's own
     * (possibly-delayed) close event can never fire our reconnect/reject
     * logic again — without this, a deliberate reconnect() races its own
     * explicit connectWebSocket() against the stale socket's onclose handler
     * scheduling a second, uncoordinated retry.
     */
    function closeSocket() {
      if (!wsRef.current) return;
      const stale = wsRef.current;
      stale.onopen = null;
      stale.onmessage = null;
      stale.onerror = null;
      stale.onclose = null;
      try {
        stale.close();
      } catch {
        // Best-effort close
      }
      socketOpenedAtRef.current = null;
    }

    /** Removes a tracked request and syncs pending count */
    function clearTrackedRequest(entry: TrackedRequest<TPayload, TResponse>) {
      if (entry.overallTimeout) {
        clearTimeout(entry.overallTimeout);
        entry.overallTimeout = null;
      }
      let removed = false;
      if (concurrent && entry.requestId) {
        removed = pendingRequestsRef.current.delete(entry.requestId);
      } else if (activeRequestRef.current === entry) {
        activeRequestRef.current = null;
        removed = true;
      }
      if (removed) {
        pendingCountRef.current = Math.max(0, pendingCountRef.current - 1);
        syncPendingCount();
      }
    }

    /** Opens or reuses the edge WebSocket */
    function connectWebSocket() {
      return connectEdgeSocket<TResponse>({
        functionPath: config.functionPath,
        concurrent,
        getAccessToken,
        getSupabaseUrl,
        wsRef,
        isExplicitDisconnectRef,
        isConnectingRef,
        retryCountRef,
        socketOpenedAtRef,
        isWarmupReadyRef,
        warmupWaitersRef,
        passiveOnServerActionRef,
        activeRequestRef: activeRequestRef as {
          current: PendingRequest<TResponse> | null;
        },
        pendingRequestsRef: pendingRequestsRef as {
          current: Map<string, PendingRequest<TResponse>>;
        },
        lastWarmupPayloadRef,
        setConnectionState,
        closeSocket,
        sendWarmupPayload,
        settleWarmupWaiters,
      });
    }

    /** Rotates the socket when near worker TTL */
    async function rotateConnectionIfNeeded(
      getExpiresAt?: () => number | null,
    ) {
      const fallbackExpires = socketOpenedAtRef.current
        ? socketOpenedAtRef.current + edgeWorkerTtlMs
        : null;
      const expiresAt = getExpiresAt?.() ?? fallbackExpires;
      if (!expiresAt) return;
      if (expiresAt - Date.now() >= edgeRotateThresholdMs) return;

      await reconnect();
    }

    /** Force-closes and reopens the socket (mid-turn edge reclaim) */
    async function reconnect() {
      if (disposed) return;
      isExplicitDisconnectRef.current = false;
      closeSocket();
      isWarmupReadyRef.current = false;
      await connectWebSocket();
    }

    if (reconnectOnBrowserOnline) {
      unsubscribeBrowserNetwork = subscribeToBrowserNetwork({
        onOnline: () => {
          if (disposed || isExplicitDisconnectRef.current) return;
          if (!lastWarmupPayloadRef.current) return;
          if (wsRef.current?.readyState === WebSocket.OPEN) return;

          void connectWebSocket().catch((err) => {
            if (!isRetriableTransportError(err)) {
              console.error("Edge stream reconnect on online failed:", err);
            }
          });
        },
      });
    }

    /** Warmups the socket and waits for server ready */
    async function warmup(payload: TPayload, options?: WarmupOptions) {
      if (options?.onServerAction) {
        passiveOnServerActionRef.current = options.onServerAction;
      }
      lastWarmupPayloadRef.current = payload;
      isWarmupReadyRef.current = false;

      const wasOpen = wsRef.current?.readyState === WebSocket.OPEN;
      await connectWebSocket();

      if (!isWarmupReadyRef.current) {
        if (wasOpen) sendWarmupPayload();
        await waitForWarmupReady();
      }
    }

    /** Sends a side-channel control message without disturbing an in-flight send() */
    async function sendControl(
      data: Record<string, unknown>,
      options?: SendControlOptions<TPayload>,
    ) {
      // Prefer explicit payload, then last warmup, then registered provider
      if (options?.warmupPayload !== undefined) {
        lastWarmupPayloadRef.current = options.warmupPayload;
      } else if (
        !lastWarmupPayloadRef.current &&
        warmupPayloadProviderRef.current
      ) {
        const resolved = warmupPayloadProviderRef.current();
        if (resolved) lastWarmupPayloadRef.current = resolved;
      }

      await connectWebSocket();

      if (!lastWarmupPayloadRef.current) {
        throw new Error("Warmup required");
      }

      if (!isWarmupReadyRef.current) {
        sendWarmupPayload();
        await waitForWarmupReady();
      }

      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        throw new Error("WebSocket not open");
      }

      wsRef.current.send(JSON.stringify({ type: "client_control", data }));
    }

    /** Registers a fallback warmup payload used by sendControl when none is cached */
    function setWarmupPayloadProvider(
      provider: (() => TPayload | null) | null,
    ) {
      warmupPayloadProviderRef.current = provider;
    }

    /** Sends a client_message and resolves on complete */
    async function send(
      payload: TPayload,
      options: StartStreamOptions<TResponse>,
    ): Promise<TResponse> {
      if (pendingCountRef.current === 0) {
        await rotateConnectionIfNeeded(options.getWorkerExpiresAt);
      }

      isExplicitDisconnectRef.current = false;

      const requestId = concurrent ? crypto.randomUUID() : undefined;
      let resolved = false;

      return new Promise<TResponse>((resolvePromise, rejectPromise) => {
        const overallTimeout = setTimeout(() => {
          if (!resolved) {
            const err = new Error("WebSocket request timeout");
            const entry = concurrent
              ? requestId
                ? pendingRequestsRef.current.get(requestId)
                : undefined
              : activeRequestRef.current;
            if (entry) clearTrackedRequest(entry);
            else {
              pendingCountRef.current = Math.max(
                0,
                pendingCountRef.current - 1,
              );
              syncPendingCount();
            }
            rejectPromise(err);
          }
        }, overallTimeoutMs);

        const ctx: EdgeFunctionMessageContext<TResponse> = {
          resolve: (value) => {
            resolved = true;
            clearTimeout(overallTimeout);
            if (options.invalidateTags && invalidateTags) {
              const shouldInvalidate = options.invalidateTags.condition
                ? options.invalidateTags.condition(value)
                : true;
              if (shouldInvalidate) {
                invalidateTags(options.invalidateTags.tags);
              }
            }
            const entry = concurrent
              ? requestId
                ? pendingRequestsRef.current.get(requestId)
                : undefined
              : activeRequestRef.current;
            if (entry) {
              entry.resolve(value);
              clearTrackedRequest(entry);
            } else {
              resolvePromise(value);
              pendingCountRef.current = Math.max(
                0,
                pendingCountRef.current - 1,
              );
              syncPendingCount();
            }
          },
          reject: (err) => {
            resolved = true;
            clearTimeout(overallTimeout);
            const entry = concurrent
              ? requestId
                ? pendingRequestsRef.current.get(requestId)
                : undefined
              : activeRequestRef.current;
            if (entry) {
              entry.reject(err);
              clearTrackedRequest(entry);
            } else {
              rejectPromise(err);
              pendingCountRef.current = Math.max(
                0,
                pendingCountRef.current - 1,
              );
              syncPendingCount();
            }
          },
          closeSocket,
          clearOverallTimeout: () => {
            clearTimeout(overallTimeout);
            const entry = concurrent
              ? requestId
                ? pendingRequestsRef.current.get(requestId)
                : undefined
              : activeRequestRef.current;
            if (entry) entry.overallTimeout = null;
          },
          isResolved: () => resolved,
        };

        const handler =
          options.onMessage ||
          createStandardAiMessageHandler<TResponse>(options.defaults || {}, {
            onServerAction: options.onServerAction,
            toUserMessage,
          });

        const entry: TrackedRequest<TPayload, TResponse> = {
          requestId,
          payload,
          options,
          ctx,
          resolve: resolvePromise,
          reject: rejectPromise,
          overallTimeout,
          handler,
        };

        pendingCountRef.current += 1;
        syncPendingCount();

        if (concurrent && requestId) {
          pendingRequestsRef.current.set(requestId, entry);
        } else {
          activeRequestRef.current = entry;
        }

        connectWebSocket()
          .then(async () => {
            const current = concurrent
              ? requestId
                ? pendingRequestsRef.current.get(requestId)
                : undefined
              : activeRequestRef.current;

            if (!current || current.sent) return;

            if (!lastWarmupPayloadRef.current) {
              throw new Error("Warmup required");
            }

            if (!isWarmupReadyRef.current) {
              sendWarmupPayload();
              await waitForWarmupReady();
            }

            const stillCurrent = concurrent
              ? requestId
                ? pendingRequestsRef.current.get(requestId)
                : undefined
              : activeRequestRef.current;

            if (
              wsRef.current?.readyState === WebSocket.OPEN &&
              stillCurrent &&
              !stillCurrent.sent
            ) {
              stillCurrent.sent = true;
              const envelope =
                concurrent && requestId
                  ? {
                      type: "client_message",
                      requestId,
                      data: payload,
                    }
                  : { type: "client_message", data: payload };
              wsRef.current.send(JSON.stringify(envelope));
            }
          })
          .catch((err) => {
            const failed = concurrent
              ? requestId
                ? pendingRequestsRef.current.get(requestId)
                : undefined
              : activeRequestRef.current;
            if (failed) {
              failed.reject(err);
              clearTrackedRequest(failed);
            } else {
              clearTimeout(overallTimeout);
              pendingCountRef.current = Math.max(
                0,
                pendingCountRef.current - 1,
              );
              syncPendingCount();
              rejectPromise(err);
            }
          });
      });
    }

    /** Aborts all pending work and closes the socket */
    function abort() {
      isExplicitDisconnectRef.current = true;
      closeSocket();
      if (concurrent) {
        for (const entry of pendingRequestsRef.current.values()) {
          if (entry.overallTimeout) clearTimeout(entry.overallTimeout);
          entry.reject(new Error("Request aborted"));
        }
        pendingRequestsRef.current.clear();
      } else if (activeRequestRef.current) {
        const entry = activeRequestRef.current;
        if (entry.overallTimeout) clearTimeout(entry.overallTimeout);
        entry.reject(new Error("Request aborted"));
        activeRequestRef.current = null;
      }
      pendingCountRef.current = 0;
      syncPendingCount();
    }

    /** Tears down reconnect listeners and closes the socket */
    function dispose() {
      disposed = true;
      unsubscribeBrowserNetwork?.();
      unsubscribeBrowserNetwork = null;
      isExplicitDisconnectRef.current = true;
      closeSocket();
    }

    return {
      warmup,
      send,
      sendControl,
      setWarmupPayloadProvider,
      reconnect,
      abort,
      getConnectionState: () => connectionState,
      subscribeConnectionState: (listener) => {
        connectionListeners.add(listener);
        listener(connectionState);
        return () => {
          connectionListeners.delete(listener);
        };
      },
      getPendingCount: () => pendingCountRef.current,
      subscribePendingCount: (listener) => {
        pendingListeners.add(listener);
        listener(pendingCountRef.current);
        return () => {
          pendingListeners.delete(listener);
        };
      },
      dispose,
    };
  };
}
