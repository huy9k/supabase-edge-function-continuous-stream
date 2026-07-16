import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeToBrowserNetwork } from "./browserNetwork";
import { connectEdgeSocket } from "./connection";
import { createStandardAiMessageHandler } from "./handler";
import { isRetriableTransportError } from "./errors";
import type { PendingRequest } from "./pendingRequest";
import type {
  ConnectionState,
  EdgeFunctionMessageContext,
  EdgeFunctionRawMessage,
  EdgeStreamConfig,
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

/** Factory for a WebSocket streaming hook wired to a host app */
export function createUseEdgeStream(deps: EdgeStreamCoreDeps) {
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

  return function useEdgeStream<
    TPayload,
    TResponse extends Record<string, unknown>,
  >(config: EdgeStreamConfig) {
    const concurrent = config.concurrent === true;

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [data, setData] = useState<TResponse | undefined>(undefined);

    const wsRef = useRef<WebSocket | null>(null);
    const isExplicitDisconnectRef = useRef(false);

    const [connectionState, setConnectionStateInternal] =
      useState<ConnectionState>("disconnected");
    const isConnectingRef = useRef(false);
    const lastWarmupPayloadRef = useRef<TPayload | null>(null);
    const isWarmupReadyRef = useRef(false);
    const warmupWaitersRef = useRef<
      Array<{ resolve: () => void; reject: (err: Error) => void }>
    >([]);
    const retryCountRef = useRef(0);
    const passiveOnServerActionRef = useRef<
      ((type: string, data: unknown) => void) | null
    >(null);
    const socketOpenedAtRef = useRef<number | null>(null);
    const onConnectionStateChangeRef = useRef(onConnectionStateChange);
    onConnectionStateChangeRef.current = onConnectionStateChange;

    const activeRequestRef = useRef<TrackedRequest<TPayload, TResponse> | null>(
      null,
    );
    const pendingRequestsRef = useRef(
      new Map<string, TrackedRequest<TPayload, TResponse>>(),
    );
    const pendingCountRef = useRef(0);

    const setConnectionState = useCallback((state: ConnectionState) => {
      setConnectionStateInternal(state);
      onConnectionStateChangeRef.current?.(state);
    }, []);

    const syncLoading = useCallback(() => {
      setIsLoading(pendingCountRef.current > 0);
    }, []);

    const settleWarmupWaiters = useCallback((warmupError?: Error) => {
      const waiters = warmupWaitersRef.current;
      warmupWaitersRef.current = [];
      if (warmupError) {
        waiters.forEach((w) => w.reject(warmupError));
        return;
      }
      waiters.forEach((w) => w.resolve());
    }, []);

    const waitForWarmupReady = useCallback(() => {
      if (isWarmupReadyRef.current) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        warmupWaitersRef.current.push({ resolve, reject });
      });
    }, []);

    const sendWarmupPayload = useCallback(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        return;
      }
      if (!lastWarmupPayloadRef.current) return;
      isWarmupReadyRef.current = false;
      wsRef.current.send(
        JSON.stringify({
          type: "client_warmup",
          data: lastWarmupPayloadRef.current,
        }),
      );
    }, []);

    useEffect(() => {
      return () => {
        isExplicitDisconnectRef.current = true;
        if (wsRef.current) {
          try {
            wsRef.current.close();
          } catch {
            // Best-effort unmount cleanup
          }
        }
      };
    }, []);

    const closeSocket = useCallback(() => {
      if (!wsRef.current) return;
      try {
        wsRef.current.close();
      } catch {
        // Best-effort close
      }
      socketOpenedAtRef.current = null;
    }, []);

    const clearTrackedRequest = useCallback(
      (entry: TrackedRequest<TPayload, TResponse>) => {
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
          syncLoading();
        }
      },
      [concurrent, syncLoading],
    );

    const abort = useCallback(() => {
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
      setIsLoading(false);
    }, [closeSocket, concurrent]);

    const connectWebSocket = useCallback(
      () =>
        connectEdgeSocket<TResponse>({
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
        }),
      [
        config.functionPath,
        concurrent,
        closeSocket,
        sendWarmupPayload,
        settleWarmupWaiters,
        setConnectionState,
      ],
    );

    const connectWebSocketRef = useRef(connectWebSocket);
    connectWebSocketRef.current = connectWebSocket;

    useEffect(() => {
      if (!reconnectOnBrowserOnline) return;

      return subscribeToBrowserNetwork({
        onOnline: () => {
          if (isExplicitDisconnectRef.current) return;
          if (!lastWarmupPayloadRef.current) return;
          if (wsRef.current?.readyState === WebSocket.OPEN) return;

          void connectWebSocketRef.current().catch((err) => {
            if (!isRetriableTransportError(err)) {
              console.error("Edge stream reconnect on online failed:", err);
            }
          });
        },
      });
    }, [reconnectOnBrowserOnline]);

    const rotateConnectionIfNeeded = useCallback(
      async (getExpiresAt?: () => number | null) => {
        const fallbackExpires = socketOpenedAtRef.current
          ? socketOpenedAtRef.current + edgeWorkerTtlMs
          : null;
        const expiresAt = getExpiresAt?.() ?? fallbackExpires;
        if (!expiresAt) return;
        if (expiresAt - Date.now() >= edgeRotateThresholdMs) return;

        isExplicitDisconnectRef.current = false;
        closeSocket();
        isWarmupReadyRef.current = false;
        await connectWebSocket();
      },
      [closeSocket, connectWebSocket, edgeRotateThresholdMs, edgeWorkerTtlMs],
    );

    const warmup = useCallback(
      async (payload: TPayload, options?: WarmupOptions) => {
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
      },
      [connectWebSocket, sendWarmupPayload, waitForWarmupReady],
    );

    /** Sends a side-channel control message without disturbing an in-flight send() */
    const sendControl = useCallback(
      async (data: Record<string, unknown>) => {
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
      },
      [connectWebSocket, sendWarmupPayload, waitForWarmupReady],
    );

    const send = useCallback(
      async (
        payload: TPayload,
        options: StartStreamOptions<TResponse>,
      ): Promise<TResponse> => {
        if (pendingCountRef.current === 0) {
          await rotateConnectionIfNeeded(options.getWorkerExpiresAt);
        }

        setError(null);
        setData(undefined);
        isExplicitDisconnectRef.current = false;

        const requestId = concurrent ? crypto.randomUUID() : undefined;
        let resolved = false;

        return new Promise<TResponse>((resolvePromise, rejectPromise) => {
          const overallTimeout = setTimeout(() => {
            if (!resolved) {
              const err = new Error("WebSocket request timeout");
              setError(err);
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
                syncLoading();
              }
              rejectPromise(err);
            }
          }, overallTimeoutMs);

          const ctx: EdgeFunctionMessageContext<TResponse> = {
            resolve: (value) => {
              resolved = true;
              clearTimeout(overallTimeout);
              setData(value);
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
                syncLoading();
              }
            },
            reject: (err) => {
              resolved = true;
              clearTimeout(overallTimeout);
              setError(err);
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
                syncLoading();
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
          syncLoading();

          if (concurrent && requestId) {
            pendingRequestsRef.current.set(requestId, entry);
          } else {
            activeRequestRef.current = entry;
          }

          connectWebSocket()
            .then(async () => {
              // Look up THIS request — never the "current" slot
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
                setError(err);
                pendingCountRef.current = Math.max(
                  0,
                  pendingCountRef.current - 1,
                );
                syncLoading();
                rejectPromise(err);
              }
            });
        });
      },
      [
        concurrent,
        connectWebSocket,
        closeSocket,
        sendWarmupPayload,
        waitForWarmupReady,
        rotateConnectionIfNeeded,
        overallTimeoutMs,
        toUserMessage,
        invalidateTags,
        clearTrackedRequest,
        syncLoading,
      ],
    );

    const isConnected = connectionState === "connected";
    const isReconnecting = connectionState === "reconnecting";

    return {
      warmup,
      send,
      sendControl,
      abort,
      isLoading,
      error,
      data,
      isConnected,
      connectionState,
      isReconnecting,
    };
  };
}
