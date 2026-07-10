import { useCallback, useEffect, useRef, useState } from "react";
import { connectEdgeSocket } from "./connection";
import { createStandardAiMessageHandler } from "./handler";
import type {
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
};

/** Factory for a WebSocket streaming hook wired to a host app */
export function createUseEdgeStream(deps: EdgeStreamCoreDeps) {
  const {
    getAccessToken,
    getSupabaseUrl,
    workerLimits,
    toUserMessage,
    invalidateTags,
  } = deps;

  const { edgeWorkerTtlMs, edgeRotateThresholdMs, overallTimeoutMs } =
    workerLimits;

  return function useEdgeStream<
    TPayload,
    TResponse extends Record<string, unknown>,
  >(config: EdgeStreamConfig) {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [data, setData] = useState<TResponse | undefined>(undefined);

    const wsRef = useRef<WebSocket | null>(null);
    const isExplicitDisconnectRef = useRef(false);

    const [isConnected, setIsConnected] = useState(false);
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

    const activeRequestRef = useRef<{
      payload: TPayload;
      options: StartStreamOptions<TResponse>;
      ctx: EdgeFunctionMessageContext<TResponse>;
      resolve: (val: TResponse) => void;
      reject: (err: Error) => void;
      overallTimeout: ReturnType<typeof setTimeout> | null;
      handler: (
        message: EdgeFunctionRawMessage,
        ctx: EdgeFunctionMessageContext<TResponse>,
      ) => void;
      sent?: boolean;
    } | null>(null);

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

    const abort = useCallback(() => {
      isExplicitDisconnectRef.current = true;
      closeSocket();
      setIsLoading(false);
      if (activeRequestRef.current) {
        activeRequestRef.current.reject(new Error("Request aborted"));
        if (activeRequestRef.current.overallTimeout) {
          clearTimeout(activeRequestRef.current.overallTimeout);
        }
        activeRequestRef.current = null;
      }
    }, [closeSocket]);

    const connectWebSocket = useCallback(
      () =>
        connectEdgeSocket<TResponse>({
          functionPath: config.functionPath,
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
          activeRequestRef,
          lastWarmupPayloadRef,
          setIsConnected,
          closeSocket,
          sendWarmupPayload,
          settleWarmupWaiters,
        }),
      [
        config.functionPath,
        closeSocket,
        sendWarmupPayload,
        settleWarmupWaiters,
      ],
    );

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
        if (!isLoading) {
          await rotateConnectionIfNeeded(options.getWorkerExpiresAt);
        }

        setIsLoading(true);
        setError(null);
        setData(undefined);
        isExplicitDisconnectRef.current = false;

        let resolved = false;

        const ctx: EdgeFunctionMessageContext<TResponse> = {
          resolve: (value) => {
            resolved = true;
            setData(value);
            setIsLoading(false);
            if (options.invalidateTags && invalidateTags) {
              const shouldInvalidate = options.invalidateTags.condition
                ? options.invalidateTags.condition(value)
                : true;
              if (shouldInvalidate) {
                invalidateTags(options.invalidateTags.tags);
              }
            }
            if (activeRequestRef.current?.overallTimeout) {
              clearTimeout(activeRequestRef.current.overallTimeout);
            }
            if (activeRequestRef.current?.resolve) {
              activeRequestRef.current.resolve(value);
            }
            activeRequestRef.current = null;
          },
          reject: (err) => {
            resolved = true;
            setError(err);
            setIsLoading(false);
            if (activeRequestRef.current?.overallTimeout) {
              clearTimeout(activeRequestRef.current.overallTimeout);
            }
            if (activeRequestRef.current?.reject) {
              activeRequestRef.current.reject(err);
            }
            activeRequestRef.current = null;
          },
          closeSocket,
          clearOverallTimeout: () => {
            if (activeRequestRef.current?.overallTimeout) {
              clearTimeout(activeRequestRef.current.overallTimeout);
            }
          },
          isResolved: () => resolved,
        };

        return new Promise<TResponse>((resolvePromise, rejectPromise) => {
          const overallTimeout = setTimeout(() => {
            if (!resolved) {
              const err = new Error("WebSocket request timeout");
              setError(err);
              setIsLoading(false);
              rejectPromise(err);
              activeRequestRef.current = null;
            }
          }, overallTimeoutMs);

          const handler =
            options.onMessage ||
            createStandardAiMessageHandler<TResponse>(options.defaults || {}, {
              onServerAction: options.onServerAction,
              toUserMessage,
            });

          activeRequestRef.current = {
            payload,
            options,
            ctx,
            resolve: resolvePromise,
            reject: rejectPromise,
            overallTimeout,
            handler,
          };

          connectWebSocket()
            .then(async () => {
              if (!activeRequestRef.current || activeRequestRef.current.sent) {
                return;
              }

              if (!lastWarmupPayloadRef.current) {
                throw new Error("Warmup required");
              }

              if (!isWarmupReadyRef.current) {
                sendWarmupPayload();
                await waitForWarmupReady();
              }

              if (
                wsRef.current?.readyState === WebSocket.OPEN &&
                activeRequestRef.current &&
                !activeRequestRef.current.sent
              ) {
                activeRequestRef.current.sent = true;
                wsRef.current.send(
                  JSON.stringify({ type: "client_message", data: payload }),
                );
              }
            })
            .catch((err) => {
              clearTimeout(overallTimeout);
              setError(err);
              setIsLoading(false);
              rejectPromise(err);
              activeRequestRef.current = null;
            });
        });
      },
      [
        connectWebSocket,
        closeSocket,
        sendWarmupPayload,
        waitForWarmupReady,
        rotateConnectionIfNeeded,
        isLoading,
        overallTimeoutMs,
        toUserMessage,
        invalidateTags,
      ],
    );

    return {
      warmup,
      send,
      sendControl,
      abort,
      isLoading,
      error,
      data,
      isConnected,
    };
  };
}
