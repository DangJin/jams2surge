import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";

import { fetchSubscription, SubscriptionFetchError } from "../src/subscription/fetch";

async function withServer(
  handler: (response: ServerResponse) => void,
  run: (url: string) => Promise<void>,
): Promise<void> {
  const server = createServer((_request, response) => handler(response));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;

  try {
    await run(`http://127.0.0.1:${address.port}/subscription?token=private`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

describe("fetchSubscription", () => {
  it("downloads a successful UTF-8 response", async () => {
    await withServer(
      (response) => {
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        response.end("ss://example");
      },
      async (url) => {
        await expect(fetchSubscription(url)).resolves.toBe("ss://example");
      },
    );
  });

  it("rejects unsupported URL schemes before making a request", async () => {
    await expect(fetchSubscription("file:///private/subscription")).rejects.toThrowError(
      new SubscriptionFetchError("订阅地址必须使用 HTTP 或 HTTPS"),
    );
  });

  it("reports a non-success HTTP status without exposing the URL", async () => {
    await withServer(
      (response) => {
        response.writeHead(500);
        response.end("private upstream details");
      },
      async (url) => {
        try {
          await fetchSubscription(url);
          expect.unreachable("the request should fail");
        } catch (error) {
          expect(error).toBeInstanceOf(SubscriptionFetchError);
          expect(String(error)).toContain("订阅服务返回 HTTP 500");
          expect(String(error)).not.toContain(url);
          expect(String(error)).not.toContain("private upstream details");
        }
      },
    );
  });

  it("rejects a declared Content-Length above the byte limit", async () => {
    await withServer(
      (response) => {
        response.writeHead(200, { "content-length": "100" });
        response.end("small");
      },
      async (url) => {
        await expect(fetchSubscription(url, { maxBytes: 10 })).rejects.toThrow("订阅响应过大");
      },
    );
  });

  it("stops a chunked response when accumulated bytes cross the limit", async () => {
    await withServer(
      (response) => {
        response.write("12345");
        response.end("67890");
      },
      async (url) => {
        await expect(fetchSubscription(url, { maxBytes: 8 })).rejects.toThrow("订阅响应过大");
      },
    );
  });

  it("rejects invalid UTF-8", async () => {
    await withServer(
      (response) => response.end(Buffer.from([0xc3, 0x28])),
      async (url) => {
        await expect(fetchSubscription(url)).rejects.toThrow("订阅响应不是有效的 UTF-8 文本");
      },
    );
  });

  it("aborts a response that exceeds the configured timeout", async () => {
    await withServer(
      (response) => {
        setTimeout(() => response.end("too late"), 100);
      },
      async (url) => {
        await expect(fetchSubscription(url, { timeoutMs: 20 })).rejects.toThrow("订阅请求超时");
      },
    );
  });
});
