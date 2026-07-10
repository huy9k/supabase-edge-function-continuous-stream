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

## Disconnect errors

```ts
import { isStreamDisconnectError } from "supabase-edge-function-continuous-stream";
```

Use `isStreamDisconnectError(error)` when ignoring benign closes after a turn already finished server-side.

## Warmup stability

Warm up **once per session mount**. Do not put `warmup` in a `useEffect` dependency list if its identity changes each render — that can close an in-flight socket. Keep a ref to the latest `warmup` and depend only on stable keys (e.g. `conversationId`).

## License

MIT
