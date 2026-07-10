import type {
  EdgeFunctionMessageContext,
  EdgeFunctionRawMessage,
  StandardAiCallbacks,
} from "./types";

/**
 * Accumulates incoming WebSocket messages into a caller-defined object shape T.
 */
export function createStandardAiMessageHandler<
  T extends Record<string, unknown>,
>(defaults: Partial<T> = {}, callbacks?: StandardAiCallbacks) {
  const state: Partial<T> = {};

  /** Builds the final response by merging defaults, accumulated state, and overrides */
  const buildResponse = (overrides?: Partial<T>): T =>
    ({
      ...defaults,
      ...state,
      ...overrides,
    }) as T;

  return (
    message: EdgeFunctionRawMessage,
    ctx: EdgeFunctionMessageContext<T>,
  ) => {
    if (message.type === "response_text" && typeof message.data === "string") {
      (state as { reply?: string }).reply = message.data;
    }

    if (
      typeof message.data === "object" &&
      message.data !== null &&
      message.type !== "error"
    ) {
      Object.assign(state, message.data);
    }

    if (message.type === "error") {
      const raw = (message.data as string | undefined) ?? "Server error";
      const userMsg = callbacks?.toUserMessage?.(raw);
      if (userMsg) callbacks?.onServerAction?.("error", userMsg);
      ctx.reject(new Error(raw));
      return;
    }

    if (message.type === "complete") {
      ctx.clearOverallTimeout();

      if (!ctx.isResolved()) {
        ctx.resolve(buildResponse(message.data as Partial<T>));
      }

      callbacks?.onServerAction?.("complete", message.data);
      return;
    }

    callbacks?.onServerAction?.(message.type, message.data);
  };
}
