export const RESPONSE_TEXT_EVENT_TYPE = "response_text" as const;

/** True when the wire message is a response text snapshot */
export function isResponseTextEvent(type: string): boolean {
  return type === RESPONSE_TEXT_EVENT_TYPE;
}

/** Folds full response_text snapshots without shrinking visible text on reconnect */
export function reduceResponseText(prev: string, next: string): string {
  if (!next.trim()) return prev;
  if (!prev.trim()) return next;
  if (next.trim().length < prev.trim().length) return prev;
  return next;
}
