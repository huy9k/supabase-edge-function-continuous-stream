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

## License

MIT
