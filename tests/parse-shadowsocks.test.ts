import { describe, expect, it } from "vitest";

import { NodeParseError, parseShadowsocksUri } from "../src/subscription/parse-shadowsocks";

describe("parseShadowsocksUri", () => {
  it("parses SIP002 Base64URL userinfo", () => {
    expect(parseShadowsocksUri("ss://YWVzLTI1Ni1nY206cEBzcw@example.com:8388#Tokyo")).toEqual({
      name: "Tokyo",
      host: "example.com",
      port: 8388,
      method: "aes-256-gcm",
      password: "p@ss",
      udpRelay: true,
    });
  });

  it("parses percent-encoded plain userinfo and IPv6", () => {
    expect(parseShadowsocksUri("ss://aes-128-gcm:p%40ss@[2001:db8::1]:443#IPv6")).toEqual({
      name: "IPv6",
      host: "2001:db8::1",
      port: 443,
      method: "aes-128-gcm",
      password: "p@ss",
      udpRelay: true,
    });
  });

  it("parses legacy whole-payload Base64 even when the password contains delimiters", () => {
    const payload = Buffer.from("chacha20-ietf-poly1305:test/!@#:@legacy.example:8888", "utf8")
      .toString("base64")
      .replace(/=+$/, "");

    expect(parseShadowsocksUri(`ss://${payload}#Legacy`)).toEqual({
      name: "Legacy",
      host: "legacy.example",
      port: 8888,
      method: "chacha20-ietf-poly1305",
      password: "test/!@#:",
      udpRelay: true,
    });
  });

  it("decodes a Unicode fragment and derives a fallback name when absent", () => {
    expect(parseShadowsocksUri("ss://YWVzLTEyOC1nY206cGFzcw@example.com:80#%E6%97%A5%E6%9C%AC").name).toBe(
      "日本",
    );
    expect(parseShadowsocksUri("ss://YWVzLTEyOC1nY206cGFzcw@example.com:80").name).toBe("SS example.com:80");
  });

  it("maps compatible simple-obfs parameters", () => {
    const uri =
      "ss://YWVzLTEyOC1nY206cGFzcw@example.com:443/?plugin=obfs-local%3Bobfs%3Dtls%3Bobfs-host%3Dcdn.example.com#Obfs";

    expect(parseShadowsocksUri(uri)).toMatchObject({
      obfs: "tls",
      obfsHost: "cdn.example.com",
    });
  });

  it("rejects unsupported plugins with a safe typed error", () => {
    expect(() =>
      parseShadowsocksUri("ss://YWVzLTEyOC1nY206cGFzcw@example.com:443/?plugin=v2ray-plugin%3Bserver#Node"),
    ).toThrowError(new NodeParseError("unsupported-plugin", "Surge 不支持此 Shadowsocks 插件"));
  });

  it.each([
    "ss://YWVzLTEyOC1nY206cGFzcw@example.com:0#Zero",
    "ss://YWVzLTEyOC1nY206cGFzcw@example.com:65536#TooHigh",
  ])("rejects an out-of-range port in %s", (uri) => {
    expect(() => parseShadowsocksUri(uri)).toThrowError(NodeParseError);
  });

  it("rejects a missing password", () => {
    expect(() => parseShadowsocksUri("ss://YWVzLTEyOC1nY206@example.com:443#Node")).toThrowError(NodeParseError);
  });

  it("rejects ciphers that Surge does not support", () => {
    const credentials = Buffer.from("unsupported-cipher:secret", "utf8").toString("base64url");

    expect(() => parseShadowsocksUri(`ss://${credentials}@example.com:443#Node`)).toThrowError(
      new NodeParseError("unsupported-method", "Surge 不支持此 Shadowsocks 加密方式"),
    );
  });
});
