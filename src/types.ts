export type EdgeFunctionRawMessage = Record<string, unknown> & { type: string };

export interface EdgeFunctionMessageContext<
  TResponse extends Record<string, unknown>,
> {
  resolve: (value: TResponse) => void;
  reject: (reason: Error) => void;
  closeSocket: () => void;
  clearOverallTimeout: () => void;
  isResolved: () => boolean;
}

export type EdgeStreamConfig = {
  functionPath: string;
};

/** Callbacks a caller can wire up for side-effects during streaming. */
export interface StandardAiCallbacks {
  onServerAction?: (type: string, data: unknown) => void;
  toUserMessage?: (error: unknown) => string | null;
}

export type WarmupOptions = {
  onServerAction?: (type: string, data: unknown) => void;
};

export type StartStreamOptions<TResponse extends Record<string, unknown>> = {
  /** Optional: Use a custom message handler. If omitted, it uses the Standard AI Protocol handler. */
  onMessage?: (
    message: EdgeFunctionRawMessage,
    ctx: EdgeFunctionMessageContext<TResponse>,
  ) => void;
  /** Optional: Defaults to seed the response object if not sent by the server. */
  defaults?: Partial<TResponse>;
  /** Optional: Listener for server actions (status, complete, etc.) */
  onServerAction?: (type: string, data: unknown) => void;
  /** Optional: Tags to invalidate on completion. */
  invalidateTags?: {
    tags: Array<string | { type: string; id?: string | number }>;
    condition?: (response?: TResponse) => boolean;
  };
  /** Optional: Edge worker expiry from server checkpoint metadata */
  getWorkerExpiresAt?: () => number | null;
};

/** Mutable ref bag used by connectEdgeSocket without React */
export type Ref<T> = { current: T };
