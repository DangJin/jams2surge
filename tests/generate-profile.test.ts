import { describe, expect, it } from "vitest";

import {
  generateSurgeProfile,
  ProfileGenerationError,
} from "../src/subscription/generate-profile";
import type { SurgeShadowsocksNode } from "../src/subscription/types";
import { EXPECTED_COMPANY_DIRECT_RULES } from "./fixtures/company-direct-domains";

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
${EXPECTED_COMPANY_DIRECT_RULES.join("\n")}
FINAL,Proxy
`);
  });

  it("routes every approved Alibaba product domain directly before the final rule", () => {
    const node: SurgeShadowsocksNode = {
      name: "Tokyo",
      host: "example.com",
      port: 443,
      method: "aes-128-gcm",
      password: "secret",
      udpRelay: true,
    };

    const profileLines = generateSurgeProfile([node]).split("\n");
    const ruleStart = profileLines.indexOf("[Rule]");
    const finalRule = profileLines.indexOf("FINAL,Proxy");
    const ruleLines = profileLines.slice(ruleStart + 1, finalRule);

    expect(ruleLines).toEqual(EXPECTED_COMPANY_DIRECT_RULES);
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
    expect(profile).toContain(
      "DOMAIN-SUFFIX,linkmodel.ai,DIRECT,extended-matching",
    );
  });

  it("rejects an empty node list", () => {
    expect(() => generateSurgeProfile([])).toThrowError(
      new ProfileGenerationError("没有可转换的 Shadowsocks 节点"),
    );
  });
});
