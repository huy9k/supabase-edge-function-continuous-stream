import type {
  EdgeFunctionMessageContext,
  EdgeFunctionRawMessage,
} from "./types";

/** In-flight send() tracked for single-flight or concurrent demux */
export type PendingRequest<TResponse extends Record<string, unknown>> = {
  requestId?: string;
  handler: (
    message: EdgeFunctionRawMessage,
    ctx: EdgeFunctionMessageContext<TResponse>,
  ) => void;
  ctx: EdgeFunctionMessageContext<TResponse>;
  sent?: boolean;
};

/** Reads optional top-level requestId from a server envelope */
export function readMessageRequestId(
  message: EdgeFunctionRawMessage,
): string | undefined {
  return typeof message.requestId === "string" ? message.requestId : undefined;
}

/**
 * Picks the pending request that should handle an inbound message.
 * Concurrent mode matches requestId; single-flight uses the active slot.
 */
export function pickPendingRequest<TResponse extends Record<string, unknown>>(
  message: EdgeFunctionRawMessage,
  opts: {
    concurrent: boolean;
    activeRequest: PendingRequest<TResponse> | null;
    pendingById: Map<string, PendingRequest<TResponse>>;
  },
): PendingRequest<TResponse> | null {
  if (opts.concurrent) {
    const requestId = readMessageRequestId(message);
    if (!requestId) return null;
    return opts.pendingById.get(requestId) ?? null;
  }
  return opts.activeRequest;
}

/** True when an unscoped message should hit passive onServerAction */
export function shouldDeliverPassive(opts: {
  concurrent: boolean;
  messageHasRequestId: boolean;
  hasActiveRequest: boolean;
}): boolean {
  if (opts.concurrent) return !opts.messageHasRequestId;
  return !opts.hasActiveRequest;
}
