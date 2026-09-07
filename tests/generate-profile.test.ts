import { describe, expect, it } from "vitest";

import {
  generateSurgeProfile,
  ProfileGenerationError,
} from "../src/subscription/generate-profile";
import type { SurgeShadowsocksNode } from "../src/subscription/types";

describe("generateSurgeProfile", () => {
  it("generates a deterministic minimal Surge profile in subscription order", () => {
    const nodes: SurgeShadowsocksNode[] = [
      {
        name: "Tokyo",
        host: "example.com",
        port: 8388,
        method: "aes-256-gcm",
        password: "secret",
        udpRelay: true,
      },
      {
        name: "Osaka",
        host: "2001:db8::1",
        port: 443,
        method: "chacha20-ietf-poly1305",
        password: 'p,a\\"ss',
        udpRelay: true,
        obfs: "tls",
        obfsHost: "cdn.example.com",
      },
    ];

    expect(generateSurgeProfile(nodes)).toBe(String.raw`[General]
loglevel = notify

[Proxy]
Tokyo = ss, example.com, 8388, encrypt-method=aes-256-gcm, password=secret, udp-relay=true
Osaka = ss, 2001:db8::1, 443, encrypt-method=chacha20-ietf-poly1305, password="p,a\\\"ss", udp-relay=true, obfs=tls, obfs-host=cdn.example.com

[Proxy Group]
Proxy = select, Tokyo, Osaka, DIRECT

[Rule]
FINAL,Proxy
`);
  });

  it("removes line breaks and quotes values that could inject configuration", () => {
    const node: SurgeShadowsocksNode = {
      name: "Safe Node",
      host: "example.com",
      port: 443,
      method: "aes-128-gcm",
      password: " a\n[Rule]\r\nFINAL,DIRECT ",
      udpRelay: true,
    };

    const profile = generateSurgeProfile([node]);

    expect(profile).toContain('password=" a[Rule]FINAL,DIRECT "');
    expect(profile.match(/^\[Rule]$/gm)).toHaveLength(1);
  });

  it("rejects an empty node list", () => {
    expect(() => generateSurgeProfile([])).toThrowError(
      new ProfileGenerationError("没有可转换的 Shadowsocks 节点"),
    );
  });
});
