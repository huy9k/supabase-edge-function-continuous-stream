export type {
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
} from "./constants";

export type { EdgeSocketConnectorDeps } from "./connection";
export { connectEdgeSocket } from "./connection";

export { createStandardAiMessageHandler } from "./handler";

export {
  isThinkingEvent,
  reduceThinking,
  THINKING_EVENT_TYPES,
} from "./thinking";
export type { ThinkingEventType } from "./thinking";

export type { EdgeWorkerLimits } from "./workerLimits";
export { DEFAULT_EDGE_WORKER_LIMITS } from "./workerLimits";

export type { EdgeStreamCoreDeps } from "./createUseEdgeStream";
export { createUseEdgeStream } from "./createUseEdgeStream";

export const PACKAGE_NAME = "supabase-edge-function-continuous-stream" as const;
