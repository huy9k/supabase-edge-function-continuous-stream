/** Client-side edge worker timing configuration */
export type EdgeWorkerLimits = {
  edgeWorkerTtlMs: number;
  edgeRotateThresholdMs: number;
  overallTimeoutMs: number;
};

/** Default limits aligned with short-lived edge workers (~2.5 min TTL) */
export const DEFAULT_EDGE_WORKER_LIMITS: EdgeWorkerLimits = {
  edgeWorkerTtlMs: 150_000,
  edgeRotateThresholdMs: 30_000,
  overallTimeoutMs: 5 * 60_000,
};
