const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

export class SubscriptionFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubscriptionFetchError";
  }
}

function parseSubscriptionUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SubscriptionFetchError("订阅地址无效");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SubscriptionFetchError("订阅地址必须使用 HTTP 或 HTTPS");
  }
  return url;
}

export async function fetchSubscription(
  value: string,
  options: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<string> {
  const url = parseSubscriptionUrl(value);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new SubscriptionFetchError(`订阅服务返回 HTTP ${response.status}`);
    }

    const declaredLength = response.headers.get("content-length");
    if (declaredLength && Number(declaredLength) > maxBytes) {
      controller.abort();
      throw new SubscriptionFetchError("订阅响应过大");
    }
    if (!response.body) return "";

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        controller.abort();
        throw new SubscriptionFetchError("订阅响应过大");
      }
      chunks.push(chunk);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new SubscriptionFetchError("订阅响应不是有效的 UTF-8 文本");
    }
  } catch (error) {
    if (error instanceof SubscriptionFetchError) throw error;
    if (timedOut) throw new SubscriptionFetchError("订阅请求超时");
    throw new SubscriptionFetchError("无法下载订阅");
  } finally {
    clearTimeout(timer);
  }
}
