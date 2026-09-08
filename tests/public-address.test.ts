import { describe, expect, it } from "vitest";
import {
  isPublicIpAddress,
  resolvePublicAddresses,
  UnsafeUpstreamError,
  validateUpstreamUrl,
  type ResolvedAddress,
  type Resolver,
} from "../src/service/public-address";

describe("isPublicIpAddress", () => {
  it.each([
    "93.184.216.34",
    "2606:2800:220:1:248:1893:25c8:1946",
    "::ffff:93.184.216.34",
  ])("accepts public address %s", (address) => {
    expect(isPublicIpAddress(address)).toBe(true);
  });

  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.0.1",
    "224.0.0.1",
    "::",
    "::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "4000::1",
    "::7f00:1",
    "::ffff:127.0.0.1",
  ])("rejects non-public address %s", (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });
});

describe("validateUpstreamUrl", () => {
  it.each([
    "https://example.com/sub",
    "https://example.com:443/sub",
    "https://93.184.216.34/sub",
    "https://[2606:2800:220:1:248:1893:25c8:1946]/sub",
  ])("accepts safe HTTPS URL %s", (value) => {
    const url = validateUpstreamUrl(value);

    expect(url).toBeInstanceOf(URL);
    expect(url.protocol).toBe("https:");
  });

  it.each([
    ["http://example.com/sub", "上游订阅地址必须使用 HTTPS"],
    ["https://user:pass@example.com/sub", "上游订阅地址不能包含凭据"],
    ["https://example.com:8443/sub", "上游订阅地址只能使用 443 端口"],
    ["https://localhost/sub", "上游订阅地址不能指向本地或内网"],
    ["https://api.localhost/sub", "上游订阅地址不能指向本地或内网"],
    ["https://127.0.0.1/sub", "上游订阅地址不能指向本地或内网"],
    ["https://[::1]/sub", "上游订阅地址不能指向本地或内网"],
    ["https://[::ffff:127.0.0.1]/sub", "上游订阅地址不能指向本地或内网"],
  ])("rejects unsafe URL %s", (value, message) => {
    expect(() => validateUpstreamUrl(value)).toThrowError(message);
  });

  it("throws the upstream-specific error type", () => {
    expect(() => validateUpstreamUrl("https://localhost/sub")).toThrow(
      UnsafeUpstreamError,
    );
  });
});

describe("resolvePublicAddresses", () => {
  it("returns every address when all DNS results are public", async () => {
    const addresses: ResolvedAddress[] = [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ];
    const resolver: Resolver = async () => addresses;

    await expect(
      resolvePublicAddresses("example.com", resolver),
    ).resolves.toEqual(addresses);
  });

  it("rejects an empty DNS result", async () => {
    const resolver: Resolver = async () => [];

    await expect(
      resolvePublicAddresses("example.com", resolver),
    ).rejects.toThrowError("上游订阅地址不能指向本地或内网");
  });

  it("rejects a private DNS result", async () => {
    const resolver: Resolver = async () => [
      { address: "192.168.0.1", family: 4 },
    ];

    await expect(
      resolvePublicAddresses("example.com", resolver),
    ).rejects.toThrow(UnsafeUpstreamError);
  });

  it("rejects mixed public and private DNS results", async () => {
    const resolver: Resolver = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "::ffff:127.0.0.1", family: 6 },
    ];

    await expect(
      resolvePublicAddresses("example.com", resolver),
    ).rejects.toThrowError("上游订阅地址不能指向本地或内网");
  });
});
