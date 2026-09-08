import { request as httpsRequest } from "node:https";
import {
  resolvePublicAddresses,
  UnsafeUpstreamError,
  validateUpstreamUrl,
  type ResolvedAddress,
  type Resolver,
} from "./public-address";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const REQUEST_HEADERS = Object.freeze({
  accept: "text/plain,*/*;q=0.1",
  "user-agent": "jams2surge/1.0",
});
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface TransportResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>;
}

export interface TransportRequest {
  signal: AbortSignal;
  addresses: readonly ResolvedAddress[];
  headers: Readonly<Record<string, string>>;
}

export type RequestTransport = (
  url: URL,
  request: TransportRequest,
) => Promise<TransportResponse>;

export interface DownloadOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  resolver?: Resolver;
  transport?: RequestTransport;
}

type DownloadErrorCode =
  | "invalid"
  | "unsafe"
  | "timeout"
  | "http"
  | "too-large"
  | "encoding"
  | "network"
  | "redirect";

const ERROR_MESSAGES: Record<DownloadErrorCode, string> = {
  invalid: "上游订阅地址或下载参数无效",
  unsafe: "上游订阅地址不符合安全要求",
  timeout: "上游订阅下载超时",
  http: "上游订阅返回异常 HTTP 状态或响应头",
  "too-large": "上游订阅内容超过大小限制",
  encoding: "上游订阅内容不是有效的 UTF-8 文本",
  network: "上游订阅下载失败",
  redirect: "上游订阅重定向无效或超过次数限制",
};

export class SafeDownloadError extends Error {
  constructor(public readonly code: DownloadErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "SafeDownloadError";
  }
}

const nodeHttpsTransport: RequestTransport = async (url, options) => {
  return new Promise((resolve, reject) => {
    const pinnedAddress = options.addresses[0];
    if (!pinnedAddress) {
      reject(new SafeDownloadError("unsafe"));
      return;
    }
    const request = httpsRequest(
      // Keep the hostname for Host, TLS SNI, and certificate verification.
      url,
      {
        method: "GET",
        headers: options.headers,
        signal: options.signal,
        rejectUnauthorized: true,
        // Avoid sharing connections with requests outside this validation flow.
        agent: false,
        lookup: (_hostname, lookupOptions, callback) => {
          // Node can request the `all` shape for family autoselection. In both
          // cases return only the validated address; never perform another DNS lookup.
          queueMicrotask(() => {
            if (lookupOptions.all) {
              callback(null, [pinnedAddress]);
            } else {
              callback(null, pinnedAddress.address, pinnedAddress.family);
            }
          });
        },
      },
      (response) => {
        // Aborting an unread redirect/error response can emit a stream error.
        response.on("error", () => {});
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: response,
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
};

export async function downloadPublicHttpsText(
  value: string,
  options: DownloadOptions = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > DEFAULT_TIMEOUT_MS ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 0 ||
    maxBytes > DEFAULT_MAX_BYTES ||
    !Number.isSafeInteger(maxRedirects) ||
    maxRedirects < 0 ||
    maxRedirects > DEFAULT_MAX_REDIRECTS
  ) {
    throw new SafeDownloadError("invalid");
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      // Reject first so the deadline consistently wins over abort errors.
      reject(new SafeDownloadError("timeout"));
      controller.abort();
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      download(value, options, maxBytes, maxRedirects, controller.signal),
      deadline,
    ]);
  } catch (error) {
    if (error instanceof SafeDownloadError) throw error;
    if (error instanceof UnsafeUpstreamError)
      throw new SafeDownloadError("unsafe");
    throw new SafeDownloadError("network");
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function download(
  value: string,
  options: DownloadOptions,
  maxBytes: number,
  maxRedirects: number,
  signal: AbortSignal,
): Promise<string> {
  const transport = options.transport ?? nodeHttpsTransport;
  for (let redirects = 0; ; redirects++) {
    signal.throwIfAborted();
    let url: URL;
    try {
      url = validateUpstreamUrl(value);
    } catch (error) {
      if (error instanceof UnsafeUpstreamError) throw error;
      throw new SafeDownloadError(redirects === 0 ? "invalid" : "redirect");
    }
    // URL.hostname includes brackets for IPv6; DNS lookup expects the bare IP.
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = await resolvePublicAddresses(hostname, options.resolver);
    signal.throwIfAborted();

    const hopController = new AbortController();
    const abortHop = () => hopController.abort();
    signal.addEventListener("abort", abortHop, { once: true });
    try {
      const response = await transport(url, {
        addresses,
        signal: hopController.signal,
        headers: REQUEST_HEADERS,
      });
      signal.throwIfAborted();
      if (REDIRECT_STATUSES.has(response.statusCode)) {
        const location = response.headers.location;
        if (
          redirects >= maxRedirects ||
          typeof location !== "string" ||
          !location
        ) {
          throw new SafeDownloadError("redirect");
        }
        try {
          value = new URL(location, url).href;
        } catch {
          throw new SafeDownloadError("redirect");
        }
        continue;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new SafeDownloadError("http");
      }

      const declaredLength = response.headers["content-length"];
      if (declaredLength !== undefined) {
        if (
          typeof declaredLength !== "string" ||
          !/^\d+$/.test(declaredLength)
        ) {
          throw new SafeDownloadError("http");
        }
        if (BigInt(declaredLength) > BigInt(maxBytes)) {
          throw new SafeDownloadError("too-large");
        }
      }

      const chunks: Uint8Array[] = [];
      let byteLength = 0;
      for await (const chunk of response.body) {
        signal.throwIfAborted();
        byteLength += chunk.byteLength;
        if (byteLength > maxBytes) throw new SafeDownloadError("too-large");
        chunks.push(chunk);
      }
      signal.throwIfAborted();
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(
          Buffer.concat(chunks, byteLength),
        );
      } catch {
        throw new SafeDownloadError("encoding");
      }
    } finally {
      signal.removeEventListener("abort", abortHop);
      // Also close unread redirect/error bodies before starting the next hop.
      hopController.abort();
    }
  }
}
