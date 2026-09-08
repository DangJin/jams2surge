import { describe, expect, it } from "vitest";

import { buildSubscriptionUrl } from "../public/generate-url.mjs";

describe("buildSubscriptionUrl", () => {
  it("保留上游订阅地址中的嵌套查询参数", () => {
    const upstreamUrl =
      "https://provider.example/subscription?token=a%2Bb%3D%3D&redirect=https%3A%2F%2Fedge.example%2Ffeed%3Fx%3D1%26y%3D2";

    const generated = buildSubscriptionUrl("https://jams.example/dashboard", {
      upstreamUrl,
      mode: "template",
      autoSelect: true,
    });

    const parsed = new URL(generated);
    expect(parsed.origin).toBe("https://jams.example");
    expect(parsed.pathname).toBe("/api/subscription");
    expect(parsed.searchParams.get("url")).toBe(upstreamUrl);
    expect(parsed.searchParams.get("mode")).toBe("template");
    expect(parsed.searchParams.get("autoSelect")).toBe("1");
  });

  it.each(["http://provider.example/sub", "ftp://provider.example/sub", "not-a-url"])(
    "拒绝非 HTTPS 上游地址：%s",
    (upstreamUrl) => {
      expect(() =>
        buildSubscriptionUrl("https://jams.example", {
          upstreamUrl,
          mode: "minimal",
          autoSelect: false,
        }),
      ).toThrow("订阅地址必须使用 HTTPS");
    },
  );
});
