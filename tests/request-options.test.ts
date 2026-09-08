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
