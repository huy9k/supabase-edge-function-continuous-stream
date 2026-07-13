import {
  CONNECTION_TIMEOUT_MS,
  INITIAL_RETRY_DELAY_MS,
  MAX_RETRIES,
  TOKEN_INITIAL_RETRY_DELAY_MS,
  TOKEN_MAX_RETRIES,
} from "./constants";
import { STREAM_DISCONNECT_MESSAGE } from "./errors";
import { retryOnNetworkError } from "./retryOnNetworkError";
import type {
  ConnectionState,
  EdgeFunctionMessageContext,
  EdgeFunctionRawMessage,
  Ref,
} from "./types";

export type EdgeSocketConnectorDeps<TResponse extends Record<string, unknown>> =
  {
    functionPath: string;
    getAccessToken: () => Promise<string>;
    getSupabaseUrl: () => string;
    wsRef: Ref<WebSocket | null>;
    isExplicitDisconnectRef: Ref<boolean>;
    isConnectingRef: Ref<boolean>;
    retryCountRef: Ref<number>;
    socketOpenedAtRef: Ref<number | null>;
    isWarmupReadyRef: Ref<boolean>;
    warmupWaitersRef: Ref<
      Array<{ resolve: () => void; reject: (err: Error) => void }>
    >;
    passiveOnServerActionRef: Ref<
      ((type: string, data: unknown) => void) | null
    >;
    activeRequestRef: Ref<{
      handler: (
        message: EdgeFunctionRawMessage,
        ctx: EdgeFunctionMessageContext<TResponse>,
      ) => void;
      ctx: EdgeFunctionMessageContext<TResponse>;
    } | null>;
    lastWarmupPayloadRef: Ref<unknown>;
    setConnectionState: (state: ConnectionState) => void;
    closeSocket: () => void;
    sendWarmupPayload: () => void;
    settleWarmupWaiters: (error?: Error) => void;
  };

/** Opens or reuses a WebSocket to a Supabase edge function */
export async function connectEdgeSocket<
  TResponse extends Record<string, unknown>,
>(deps: EdgeSocketConnectorDeps<TResponse>): Promise<void> {
  const {
    functionPath,
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
    setConnectionState,
    closeSocket,
    sendWarmupPayload,
    settleWarmupWaiters,
  } = deps;

  if (wsRef.current?.readyState === WebSocket.OPEN) return Promise.resolve();
  if (isConnectingRef.current) {
    return new Promise<void>((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          clearInterval(checkInterval);
          resolve();
        } else if (wsRef.current?.readyState === WebSocket.CLOSED) {
          clearInterval(checkInterval);
          reject(new Error("Connection closed during check"));
        }
      }, 100);
    });
  }

  isConnectingRef.current = true;
  isExplicitDisconnectRef.current = false;
  setConnectionState("connecting");

  try {
    const accessToken = await retryOnNetworkError(() => getAccessToken(), {
      maxRetries: TOKEN_MAX_RETRIES,
      initialDelayMs: TOKEN_INITIAL_RETRY_DELAY_MS,
    });
    const supabaseUrl = getSupabaseUrl();
    if (!supabaseUrl) throw new Error("Missing Supabase URL");

    const wsUrl = supabaseUrl.replace(/^https?:\/\//, (m: string) =>
      m === "https://" ? "wss://" : "ws://",
    );
    const functionUrl = `${wsUrl}/functions/v1/${functionPath}`;

    return await new Promise<void>((resolveConnection, rejectConnection) => {
      let connectionTimeout: ReturnType<typeof setTimeout> | null = null;

      if (wsRef.current) {
        try {
          wsRef.current.onopen = null;
          wsRef.current.onmessage = null;
          wsRef.current.onerror = null;
          wsRef.current.onclose = null;
          if (
            wsRef.current.readyState === WebSocket.OPEN ||
            wsRef.current.readyState === WebSocket.CONNECTING
          ) {
            wsRef.current.close();
          }
        } catch {
          // Best-effort cleanup of a stale socket
        }
      }

      const urlWithToken = new URL(functionUrl);
      urlWithToken.searchParams.set("jwt", accessToken);
      wsRef.current = new WebSocket(urlWithToken.toString());

      if (retryCountRef.current === 0) {
        connectionTimeout = setTimeout(() => {
          if (wsRef.current && wsRef.current.readyState !== WebSocket.OPEN) {
            isExplicitDisconnectRef.current = false;
            closeSocket();
          }
        }, CONNECTION_TIMEOUT_MS);
      }

      wsRef.current.onopen = () => {
        if (connectionTimeout) clearTimeout(connectionTimeout);
        retryCountRef.current = 0;
        isConnectingRef.current = false;
        setConnectionState("connected");
        socketOpenedAtRef.current = Date.now();

        if (lastWarmupPayloadRef.current) {
          sendWarmupPayload();
        }

        resolveConnection();
      };

      wsRef.current.onerror = () => {
        // Handled by onclose
      };

      const retryConnect = () => {
        connectEdgeSocket(deps).then(resolveConnection).catch(rejectConnection);
      };

      wsRef.current.onclose = () => {
        if (connectionTimeout) clearTimeout(connectionTimeout);
        isConnectingRef.current = false;
        isWarmupReadyRef.current = false;

        const willRetry =
          !isExplicitDisconnectRef.current &&
          retryCountRef.current < MAX_RETRIES;
        if (isExplicitDisconnectRef.current) {
          setConnectionState("disconnected");
          settleWarmupWaiters();
        } else if (!willRetry) {
          setConnectionState("disconnected");
          settleWarmupWaiters(new Error("WebSocket closed"));
        } else {
          setConnectionState("reconnecting");
        }

        const active = activeRequestRef.current;
        if (active && !active.ctx.isResolved()) {
          active.ctx.reject(new Error(STREAM_DISCONNECT_MESSAGE));
        }

        if (isExplicitDisconnectRef.current) {
          rejectConnection(new Error("WebSocket closed by server or aborted"));
        } else if (retryCountRef.current < MAX_RETRIES) {
          retryCountRef.current++;
          const delay =
            INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCountRef.current - 1);
          setTimeout(retryConnect, delay);
        } else {
          rejectConnection(
            new Error(
              `WebSocket connection failed after ${retryCountRef.current} retries`,
            ),
          );
        }
      };

      wsRef.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as EdgeFunctionRawMessage;

          if (message.type === "status" && message.data === "ready") {
            isWarmupReadyRef.current = true;
            settleWarmupWaiters();
          }

          if (
            message.type === "error" &&
            warmupWaitersRef.current.length > 0 &&
            !isWarmupReadyRef.current
          ) {
            isWarmupReadyRef.current = false;
            settleWarmupWaiters(
              new Error(String(message.data ?? "Warmup failed")),
            );
          }

          const passive = passiveOnServerActionRef.current;
          if (passive && !activeRequestRef.current) {
            const isWarmupControl =
              message.type === "status" &&
              (message.data === "ready" || message.data === "context");
            if (!isWarmupControl) {
              passive(message.type, message.data);
            }
          }

          if (!activeRequestRef.current) return;

          const { ctx, handler } = activeRequestRef.current;
          handler(message, ctx);
        } catch (error) {
          if (!activeRequestRef.current) return;
          const ctx = activeRequestRef.current.ctx;
          ctx.reject(
            new Error(
              `Failed to parse WebSocket message: ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
          );
        }
      };
    });
  } catch (err) {
    isConnectingRef.current = false;
    setConnectionState("disconnected");
    const error = err instanceof Error ? err : new Error(String(err));
    settleWarmupWaiters(error);
    throw error;
  }
}
