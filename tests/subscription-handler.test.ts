import { describe, expect, it, vi } from "vitest";

import { SafeDownloadError } from "../src/service/safe-download";
import { createSubscriptionHandler } from "../src/service/subscription-handler";

function sip002(name: string, password = "secret"): string {
  const credentials = Buffer.from(`aes-256-gcm:${password}`, "utf8").toString(
    "base64url",
  );
  return `ss://${credentials}@node.example.com:443#${encodeURIComponent(name)}`;
}

const subscriptionWithTokyo = sip002("Tokyo");
const subscriptionWithOsaka = sip002("Osaka");
const templateFixture = `[General]
loglevel = notify
[Proxy]
# nodes
[Proxy Group]
代理 = select, DIRECT
[Rule]
FINAL,代理
`;

function request(query: string, init?: RequestInit): Request {
  return new Request(`https://service.test/api/subscription?${query}`, init);
}

function expectSafeHeaders(response: Response): void {
  expect(response.headers.get("content-type")).toBe(
    "text/plain; charset=utf-8",
  );
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
}

describe("createSubscriptionHandler", () => {
  it("downloads and converts a fresh minimal profile", async () => {
    const upstreamBodies = [subscriptionWithTokyo, subscriptionWithOsaka];
    const handler = createSubscriptionHandler({
      downloadText: async () => upstreamBodies.shift()!,
    });
    const url =
      "https://service.test/api/subscription?url=https%3A%2F%2Fupstream.test%2Fsub&mode=minimal&autoSelect=0";

    const first = await handler(new Request(url));
    const second = await handler(new Request(url));

    expect(first.status).toBe(200);
    expect(await first.text()).toContain("Tokyo = ss");
    expect(await second.text()).toContain("Osaka = ss");
    expectSafeHeaders(first);
  });

  it("marks a successful response as the same remotely managed profile", async () => {
    const handler = createSubscriptionHandler({
      downloadText: async () => subscriptionWithTokyo,
    });
    const url =
      "https://service.test/api/subscription?url=https%3A%2F%2Fupstream.test%2Fsub&mode=minimal&autoSelect=0";

    const response = await handler(new Request(url));

    expect(await response.text()).toMatch(
      /^#!MANAGED-CONFIG https:\/\/service\.test\/api\/subscription\?source=aHR0cHM6Ly91cHN0cmVhbS50ZXN0L3N1Yg&mode=minimal&autoSelect=0 interval=86400 strict=true\n\[General]/,
    );
  });

  it("rejects non-GET requests without downloading", async () => {
    const downloadText = vi.fn(async () => subscriptionWithTokyo);
    const response = await createSubscriptionHandler({ downloadText })(
      request("url=https%3A%2F%2Fupstream.test%2Fsub", { method: "POST" }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect(downloadText).not.toHaveBeenCalled();
    expectSafeHeaders(response);
  });

  it.each([
    ["", "缺少上游订阅地址"],
    ["url=https%3A%2F%2Fupstream.test%2Fsub&mode=other", "输出模式无效"],
    [
      "url=https%3A%2F%2Fupstream.test%2Fsub&autoSelect=yes",
      "自动选择参数无效",
    ],
  ])("returns 400 for invalid request options", async (query, message) => {
    const downloadText = vi.fn(async () => subscriptionWithTokyo);
    const response = await createSubscriptionHandler({ downloadText })(
      request(query),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe(message);
    expect(downloadText).not.toHaveBeenCalled();
    expectSafeHeaders(response);
  });

  it("returns 422 when the subscription has no compatible nodes", async () => {
    const response = await createSubscriptionHandler({
      downloadText: async () => "vless://secret@node.example.com:443",
    })(request("url=https%3A%2F%2Fupstream.test%2Fsub&mode=minimal"));

    expect(response.status).toBe(422);
    expect(await response.text()).toBe("没有可转换的 Shadowsocks 节点");
    expectSafeHeaders(response);
  });

  it.each(["invalid" as const, "unsafe" as const])(
    "maps caller-provided upstream %s errors to 400 without leaking details",
    async (code) => {
      const error = new SafeDownloadError(code);
      error.message = "injected internal detail token=abc";
      const response = await createSubscriptionHandler({
        downloadText: async () => {
          throw error;
        },
      })(
        request(
          "url=https%3A%2F%2Fupstream.test%2Fsub%3Ftoken%3Dabc&mode=minimal",
        ),
      );
      const body = await response.text();

      expect(response.status).toBe(400);
      expect(body).toBe("上游订阅地址无效");
      expect(body).not.toContain("token=abc");
      expect(body).not.toContain("injected internal detail");
      expectSafeHeaders(response);
    },
  );

  it.each(["invalid" as const, "unsafe" as const])(
    "keeps fixed-template %s errors as 502 without leaking details",
    async (code) => {
      const error = new SafeDownloadError(code);
      error.message = "injected template detail token=abc";
      const response = await createSubscriptionHandler({
        templateUrl: "https://template.test/Surge-Mac.conf",
        downloadText: async (url) => {
          if (url.includes("template.test")) throw error;
          return subscriptionWithTokyo;
        },
      })(
        request(
          "url=https%3A%2F%2Fupstream.test%2Fsub%3Ftoken%3Dabc&mode=template",
        ),
      );
      const body = await response.text();

      expect(response.status).toBe(502);
      expect(body).toBe("上游订阅下载失败");
      expect(body).not.toContain("token=abc");
      expect(body).not.toContain("injected template detail");
      expectSafeHeaders(response);
    },
  );

  it.each([
    ["timeout" as const, 504],
    ["network" as const, 502],
    ["http" as const, 502],
  ])(
    "maps safe download %s errors without leaking details",
    async (code, status) => {
      const response = await createSubscriptionHandler({
        downloadText: async () => {
          throw new SafeDownloadError(code);
        },
      })(request("url=https%3A%2F%2Fupstream.test%2Fsub%3Ftoken%3Dabc"));
      const body = await response.text();

      expect(response.status).toBe(status);
      expect(body).not.toContain("token=abc");
      expect(body).not.toContain("upstream response fixture");
      expectSafeHeaders(response);
    },
  );

  it("hides unexpected exception messages", async () => {
    const response = await createSubscriptionHandler({
      downloadText: async () => {
        throw new Error("injected exception message token=abc");
      },
    })(request("url=https%3A%2F%2Fupstream.test%2Fsub%3Ftoken%3Dabc"));
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).toBe("在线订阅转换失败");
    expect(body).not.toContain("token=abc");
    expect(body).not.toContain("injected exception message");
    expectSafeHeaders(response);
  });

  it("rejects an oversized generated profile without returning a partial profile", async () => {
    const oversizedNode = sip002("A".repeat(4 * 1024 * 1024));
    const response = await createSubscriptionHandler({
      downloadText: async () => oversizedNode,
    })(request("url=https%3A%2F%2Fupstream.test%2Fsub&mode=minimal"));
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).toBe("生成的 Surge 配置超过大小限制");
    expect(body).not.toContain("A".repeat(1_000));
    expectSafeHeaders(response);
  });

  it.each([
    ["1", "自动选择 = url-test"],
    ["0", "代理 = select, Tokyo, DIRECT"],
  ])("merges the fixed template with autoSelect=%s", async (flag, expected) => {
    const requested: string[] = [];
    const handler = createSubscriptionHandler({
      templateUrl: "https://template.test/Surge-Mac.conf",
      downloadText: async (url) => {
        requested.push(url);
        return url.includes("template.test")
          ? templateFixture
          : subscriptionWithTokyo;
      },
    });

    const response = await handler(
      request(
        `url=https%3A%2F%2Fupstream.test%2Fsub&mode=template&autoSelect=${flag}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(expected);
    expect(requested).toEqual([
      "https://upstream.test/sub",
      "https://template.test/Surge-Mac.conf",
    ]);
  });

  it("downloads only the upstream subscription in minimal mode", async () => {
    const requested: string[] = [];
    const handler = createSubscriptionHandler({
      templateUrl: "https://template.test/Surge-Mac.conf",
      downloadText: async (url) => {
        requested.push(url);
        return subscriptionWithTokyo;
      },
    });

    const response = await handler(
      request("url=https%3A%2F%2Fupstream.test%2Fsub&mode=minimal"),
    );

    expect(response.status).toBe(200);
    expect(requested).toEqual(["https://upstream.test/sub"]);
  });
});
