# supabase-edge-function-continuous-stream

Continuous WebSocket streaming for Supabase edge functions. Keeps a persistent connection alive across cold starts, supports warmup/context loading, and streams AI responses with automatic retry and worker TTL rotation.

This is intended to be used with [@huy9k/supabase-edge-function-helpers](https://jsr.io/@huy9k/supabase-edge-function-helpers).

## Install

```bash
npm install supabase-edge-function-continuous-stream
```

## Entries

| Import                                           | React required? | Use for                                                      |
| ------------------------------------------------ | --------------- | ------------------------------------------------------------ |
| `supabase-edge-function-continuous-stream`       | No              | `connectEdgeSocket`, `createStandardAiMessageHandler`, types |
| `supabase-edge-function-continuous-stream/react` | Yes             | `createUseEdgeStream` hook factory                           |

## React usage

Prefer the main entry (works with Next.js webpack and published npm installs):

```ts
import { createUseEdgeStream } from "supabase-edge-function-continuous-stream";
```

For explicit React-only imports:

```ts
import { createUseEdgeStream } from "supabase-edge-function-continuous-stream/react";
```

```ts
import { DEFAULT_EDGE_WORKER_LIMITS } from "supabase-edge-function-continuous-stream";

export const useEdgeStream = createUseEdgeStream({
  getAccessToken: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.access_token) throw new Error("Not authenticated");
    return data.session.access_token;
  },
  getSupabaseUrl: () => process.env.NEXT_PUBLIC_SUPABASE_URL!,
  workerLimits: DEFAULT_EDGE_WORKER_LIMITS,
});
```

## Wire protocol

1. Client opens WebSocket with JWT query param
2. `client_warmup` → server responds `status: ready`
3. `client_message` → streamed events → `complete`
4. `client_control` (optional, during step 3) → side-channel actions such as stop/cancel

Use `sendControl(data)` on the hook — it does not disturb an in-flight `send()`.

**Thinking stream** (agent liveness UI):

| Event                | `data` | Client reducer              |
| -------------------- | ------ | --------------------------- |
| `thinking_paragraph` | string | new paragraph               |
| `thinking_delta`     | string | append to current paragraph |
| `thinking_snapshot`  | string | replace full block          |

Use `reduceThinking` and `isThinkingEvent` from this package on the client.
Pair with `createThinkingStream` from `supabase-edge-function-helpers` on the server.

## Send lifecycle

On `complete`, the standard handler **resolves `send()` before `onServerAction`**.
Consumers can tear down sockets or unmount UI in `onServerAction` without racing the send promise.

## Retriable transport errors

```ts
import {
  isRetriableTransportError,
  isStreamDisconnectError,
  isNetworkError,
} from "supabase-edge-function-continuous-stream";
```

| Helper | Use when |
| ------ | -------- |
| `isRetriableTransportError(error)` | **Recommended** — suppress rollback/toast for transient connectivity (fetch failures + socket drops) |
| `isStreamDisconnectError(error)` | Socket closed mid-stream after a send started |
| `isNetworkError(error)` | `Failed to fetch` / network errors before the socket opens |

Auth errors (`Not authenticated`, `Unauthorized`) are never classified as retriable.

`getAccessToken` is retried automatically on network errors before opening the WebSocket (`TOKEN_MAX_RETRIES`, exponential backoff).

## Connection state

The hook exposes:

- `connectionState`: `"disconnected" | "connecting" | "connected" | "reconnecting"`
- `isConnected`: `connectionState === "connected"`
- `isReconnecting`: `connectionState === "reconnecting"`

Optional factory options:

```ts
createUseEdgeStream({
  // ...
  reconnectOnBrowserOnline: true,
  onConnectionStateChange: (state) => { /* ... */ },
});
```

`reconnectOnBrowserOnline` proactively reconnects when the browser fires `online` and a warmup payload is cached.

`subscribeToBrowserNetwork` is also exported for custom offline/online UI (no toasts in this package).

## Recovery checklist

1. Call `warmup()` once per mounted session (stable `useEffect` deps).
2. Do not call `abort()` for network blips — it disables auto-retry.
3. Use `isRetriableTransportError` in send error handlers before rolling back optimistic UI.
4. Enable `reconnectOnBrowserOnline: true` when the app should reconnect immediately on `online`.
5. Use `reduceThinkingReconnect` / `reduceResponseText` in `onServerAction` for replay after reconnect.

## Disconnect errors

```ts
import { isStreamDisconnectError } from "supabase-edge-function-continuous-stream";
```

Prefer `isRetriableTransportError` for new code. Use `isStreamDisconnectError` alone when you only want to ignore socket teardown after a turn already finished server-side.

## Warmup stability

Warm up **once per session mount**. Do not put `warmup` in a `useEffect` dependency list if its identity changes each render — that can close an in-flight socket. Keep a ref to the latest `warmup` and depend only on stable keys (e.g. `conversationId`).

## License

MIT
