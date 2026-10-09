export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Exponential backoff with full jitter: random delay in [0, min(cap, base * 2^attempt)]. */
export function backoffDelay(attempt: number, base = 250, cap = 8_000): number {
  return Math.random() * Math.min(cap, base * 2 ** attempt);
}

/**
 * The body of a request as text, or `undefined` when it has more than `maxBytes` bytes. Reading stops
 * there, so a sender cannot make the server hold a body of any size.
 */
export async function readBodyCapped(request: Request, maxBytes: number): Promise<string | undefined> {
  if (Number(request.headers.get("content-length")) > maxBytes) return undefined;
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      reader.cancel().catch(() => {});
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
