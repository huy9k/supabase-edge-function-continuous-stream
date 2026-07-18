export type {
  ConnectionState,
  EdgeFunctionMessageContext,
  EdgeFunctionRawMessage,
  EdgeStreamConfig,
  Ref,
  StandardAiCallbacks,
  StartStreamOptions,
  WarmupOptions,
} from "./types";

export {
  CONNECTION_TIMEOUT_MS,
  INITIAL_RETRY_DELAY_MS,
  MAX_RETRIES,
  TOKEN_INITIAL_RETRY_DELAY_MS,
  TOKEN_MAX_RETRIES,
} from "./constants";

export type { EdgeSocketConnectorDeps } from "./connection";
export { connectEdgeSocket } from "./connection";

export type { PendingRequest } from "./pendingRequest";
export {
  pickPendingRequest,
  readMessageRequestId,
  shouldDeliverPassive,
} from "./pendingRequest";

export { createStandardAiMessageHandler } from "./handler";

export {
  isNetworkError,
  isRetriableTransportError,
  isStreamDisconnectError,
  NETWORK_ERROR_MESSAGE,
  STREAM_DISCONNECT_MESSAGE,
} from "./errors";

export { retryOnNetworkError } from "./retryOnNetworkError";
export type { RetryOnNetworkErrorOptions } from "./retryOnNetworkError";

export { subscribeToBrowserNetwork } from "./browserNetwork";
export type { BrowserNetworkHandlers } from "./browserNetwork";

export {
  isThinkingEvent,
  reduceThinking,
  reduceThinkingReconnect,
  THINKING_EVENT_TYPES,
} from "./thinking";
export type {
  ReduceThinkingReconnectOptions,
  ThinkingEventType,
} from "./thinking";

export type { EdgeWorkerLimits } from "./workerLimits";
export { DEFAULT_EDGE_WORKER_LIMITS } from "./workerLimits";

export type {
  EdgeStreamClient,
  EdgeStreamCoreDeps,
} from "./createEdgeStreamClient";
export { createEdgeStreamClient } from "./createEdgeStreamClient";
export { createUseEdgeStream } from "./createUseEdgeStream";

export {
  isResponseTextEvent,
  reduceResponseText,
  RESPONSE_TEXT_EVENT_TYPE,
} from "./responseText";

export const PACKAGE_NAME = "supabase-edge-function-continuous-stream" as const;
