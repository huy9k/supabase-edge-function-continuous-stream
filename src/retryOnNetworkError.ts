import {
  TOKEN_INITIAL_RETRY_DELAY_MS,
  TOKEN_MAX_RETRIES,
} from "./constants";
import { isNetworkError } from "./errors";

export type RetryOnNetworkErrorOptions = {
  maxRetries?: number;
  initialDelayMs?: number;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Retries an async call when isNetworkError matches; rethrows immediately otherwise */
export async function retryOnNetworkError<T>(
  fn: () => Promise<T>,
  options?: RetryOnNetworkErrorOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? TOKEN_MAX_RETRIES;
  const initialDelayMs = options?.initialDelayMs ?? TOKEN_INITIAL_RETRY_DELAY_MS;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isNetworkError(error) || attempt >= maxRetries) {
        throw error;
      }
      const delay = initialDelayMs * Math.pow(2, attempt);
      await sleep(delay);
    }
  }

  throw lastError;
}
