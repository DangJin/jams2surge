import { describe, expect, it } from "vitest";
import { parseSubscriptionRequest } from "../src/service/request-options";

describe("parseSubscriptionRequest", () => {
  it("uses template mode and automatic selection by default", () => {
    expect(
      parseSubscriptionRequest(
        "https://service.test/api/subscription?url=https%3A%2F%2Fupstream.test%2Fsub%3Ftoken%3Dabc",
      ),
    ).toEqual({
      upstreamUrl: "https://upstream.test/sub?token=abc",
      mode: "template",
      autoSelect: true,
    });
  });

  it("accepts minimal mode with automatic selection disabled", () => {
    expect(
      parseSubscriptionRequest(
        "https://service.test/api/subscription?url=https%3A%2F%2Fupstream.test%2Fsub&mode=minimal&autoSelect=0",
      ),
    ).toEqual({
      upstreamUrl: "https://upstream.test/sub",
      mode: "minimal",
      autoSelect: false,
    });
  });

  it("decodes a Base64URL source without path separators", () => {
    expect(
      parseSubscriptionRequest(
        "https://service.test/api/subscription?source=aHR0cHM6Ly9wcm92aWRlci5leGFtcGxlL3N1Yj90b2tlbj1hJnVzZXI9Yg&mode=minimal&autoSelect=0",
      ),
    ).toEqual({
      upstreamUrl: "https://provider.example/sub?token=a&user=b",
      mode: "minimal",
      autoSelect: false,
    });
  });

  it.each(["*", "a", "_w"])(
    "rejects an invalid Base64URL source: %s",
    (source) => {
      expect(() =>
        parseSubscriptionRequest(
          `https://service.test/api/subscription?source=${encodeURIComponent(source)}`,
        ),
      ).toThrowError("上游订阅地址无效");
    },
  );

  it.each([
    ["https://service.test/api/subscription", "缺少上游订阅地址"],
    ["https://service.test/api/subscription?url=", "缺少上游订阅地址"],
    [
      "https://service.test/api/subscription?url=https%3A%2F%2Fupstream.test%2Fsub&mode=other",
      "输出模式无效",
    ],
    [
      "https://service.test/api/subscription?url=https%3A%2F%2Fupstream.test%2Fsub&autoSelect=yes",
      "自动选择参数无效",
    ],
  ])("rejects invalid request options", (url, message) => {
    expect(() => parseSubscriptionRequest(url)).toThrowError(message);
  });
});
