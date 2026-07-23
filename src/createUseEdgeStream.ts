import { useCallback, useEffect, useRef, useState } from "react";
import {
  createEdgeStreamClient,
  type EdgeStreamClient,
  type EdgeStreamCoreDeps,
} from "./createEdgeStreamClient";
import type {
  ConnectionState,
  EdgeStreamConfig,
  SendControlOptions,
  StartStreamOptions,
  WarmupOptions,
} from "./types";

export type { EdgeStreamCoreDeps } from "./createEdgeStreamClient";

/** Factory for a WebSocket streaming hook wired to a host app */
export function createUseEdgeStream(deps: EdgeStreamCoreDeps) {
  const createClient = createEdgeStreamClient(deps);

  return function useEdgeStream<
    TPayload,
    TResponse extends Record<string, unknown>,
  >(config: EdgeStreamConfig) {
    const clientRef = useRef<EdgeStreamClient<TPayload, TResponse> | null>(
      null,
    );
    if (!clientRef.current) {
      clientRef.current = createClient<TPayload, TResponse>(config);
    }
    const client = clientRef.current;

    const [isLoading, setIsLoading] = useState(
      () => client.getPendingCount() > 0,
    );
    const [error, setError] = useState<Error | null>(null);
    const [data, setData] = useState<TResponse | undefined>(undefined);
    const [connectionState, setConnectionState] = useState<ConnectionState>(
      () => client.getConnectionState(),
    );

    useEffect(() => {
      const unsubConn = client.subscribeConnectionState(setConnectionState);
      const unsubPending = client.subscribePendingCount((count) => {
        setIsLoading(count > 0);
      });
      return () => {
        unsubConn();
        unsubPending();
        client.dispose();
        clientRef.current = null;
      };
    }, [client]);

    const warmup = useCallback(
      (payload: TPayload, options?: WarmupOptions) =>
        client.warmup(payload, options),
      [client],
    );

    const sendControl = useCallback(
      (
        controlData: Record<string, unknown>,
        options?: SendControlOptions<TPayload>,
      ) => client.sendControl(controlData, options),
      [client],
    );

    const setWarmupPayloadProvider = useCallback(
      (provider: (() => TPayload | null) | null) =>
        client.setWarmupPayloadProvider(provider),
      [client],
    );

    const abort = useCallback(() => {
      client.abort();
      setIsLoading(false);
    }, [client]);

    const reconnect = useCallback(() => client.reconnect(), [client]);

    const send = useCallback(
      async (
        payload: TPayload,
        options: StartStreamOptions<TResponse>,
      ): Promise<TResponse> => {
        setError(null);
        setData(undefined);
        try {
          const result = await client.send(payload, options);
          setData(result);
          return result;
        } catch (err: unknown) {
          const next = err instanceof Error ? err : new Error(String(err));
          setError(next);
          throw next;
        }
      },
      [client],
    );

    const isConnected = connectionState === "connected";
    const isReconnecting = connectionState === "reconnecting";

    return {
      warmup,
      send,
      sendControl,
      setWarmupPayloadProvider,
      reconnect,
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
