import { describe, expect, it } from "vitest";

import { decodeSubscription, SubscriptionDecodeError } from "../src/subscription/decode";

describe("decodeSubscription", () => {
  it("keeps non-empty lines from a recognized plain-text subscription in order", () => {
    expect(decodeSubscription("ss://one\n\nvless://two\nunknown://three")).toEqual([
      "ss://one",
      "vless://two",
      "unknown://three",
    ]);
  });

  it("decodes standard Base64 with omitted padding", () => {
    const encoded = Buffer.from("ss://one\nvless://two", "utf8").toString("base64").replace(/=+$/, "");

    expect(decodeSubscription(encoded)).toEqual(["ss://one", "vless://two"]);
  });

  it("decodes Base64URL and strips a UTF-8 BOM", () => {
    const encoded = Buffer.from("\uFEFFss://one", "utf8").toString("base64url");

    expect(decodeSubscription(encoded)).toEqual(["ss://one"]);
  });

  it("rejects empty content", () => {
    expect(() => decodeSubscription("  ")).toThrow(SubscriptionDecodeError);
  });

  it("rejects unrecognized content without echoing it", () => {
    const secret = "secret-response-body";

    expect(() => decodeSubscription(secret)).toThrow("无法识别订阅格式");
    try {
      decodeSubscription(secret);
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
