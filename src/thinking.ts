export const THINKING_EVENT_TYPES = [
  "thinking_paragraph",
  "thinking_delta",
  "thinking_snapshot",
] as const;

export type ThinkingEventType = (typeof THINKING_EVENT_TYPES)[number];

/** True when the wire message is a thinking stream event */
export function isThinkingEvent(type: string): type is ThinkingEventType {
  return (THINKING_EVENT_TYPES as readonly string[]).includes(type);
}

/** Folds thinking wire events into accumulated display text */
export function reduceThinking(
  prev: string,
  type: string,
  data: unknown,
): string {
  if (typeof data !== "string") return prev;

  if (type === "thinking_snapshot") return data;

  if (type === "thinking_paragraph") {
    return prev.trim() ? `${prev.trimEnd()}\n\n${data}` : data;
  }

  if (type === "thinking_delta") {
    return prev + data;
  }

  return prev;
}

export type ReduceThinkingReconnectOptions = {
  isSending?: boolean;
};

/** Folds thinking events without replacing visible text mid-turn (WS reconnect) */
export function reduceThinkingReconnect(
  prev: string,
  type: string,
  data: unknown,
  _options?: ReduceThinkingReconnectOptions,
): string {
  if (typeof data !== "string") return prev;

  if (!prev.trim()) {
    return reduceThinking(prev, type, data);
  }

  if (type === "thinking_snapshot") {
    const snapshot = data.trim();
    if (!snapshot) return prev;
    if (prev.includes(snapshot)) return prev;
    return `${prev.trimEnd()}\n\n${data}`;
  }

  return reduceThinking(prev, type, data);
}
