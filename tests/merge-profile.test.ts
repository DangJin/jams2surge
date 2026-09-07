import { describe, expect, it } from "vitest";

import {
  mergeSurgeTemplate,
  TemplateMergeError,
} from "../src/subscription/merge-profile";
import type { SurgeShadowsocksNode } from "../src/subscription/types";

const template = `[General]
loglevel = notify
[Proxy]
# 请在此添加自己的节点。
[Proxy Group]
代理 = select, DIRECT
OpenAI = select, 代理, DIRECT
[Rule]
FINAL,代理
`;

const nodes: SurgeShadowsocksNode[] = [
  {
    name: "Tokyo",
    host: "tokyo.example.com",
    port: 8388,
    method: "aes-256-gcm",
    password: "secret",
    udpRelay: true,
  },
  {
    name: "Osaka",
    host: "osaka.example.com",
    port: 443,
    method: "chacha20-ietf-poly1305",
    password: "secret",
    udpRelay: true,
  },
];

describe("mergeSurgeTemplate", () => {
  it("injects proxies and wires them through an automatic selection group", () => {
    expect(mergeSurgeTemplate(template, nodes, { autoSelect: true }))
      .toBe(`[General]
loglevel = notify
[Proxy]
# 请在此添加自己的节点。
Tokyo = ss, tokyo.example.com, 8388, encrypt-method=aes-256-gcm, password=secret, udp-relay=true
Osaka = ss, osaka.example.com, 443, encrypt-method=chacha20-ietf-poly1305, password=secret, udp-relay=true
[Proxy Group]
自动选择 = url-test, Tokyo, Osaka, url=http://www.gstatic.com/generate_204, interval=600, tolerance=100
代理 = select, 自动选择, Tokyo, Osaka, DIRECT
OpenAI = select, 代理, DIRECT
[Rule]
DOMAIN-SUFFIX,linkmodel.ai,DIRECT,extended-matching
FINAL,代理
`);
  });

  it("can merge without adding the automatic selection group", () => {
    const profile = mergeSurgeTemplate(template, nodes, { autoSelect: false });

    expect(profile).not.toContain("自动选择 = url-test");
    expect(profile).toContain("代理 = select, Tokyo, Osaka, DIRECT");
  });

  it("renames nodes that collide with existing proxies or policy groups", () => {
    const conflictingTemplate = template.replace(
      "# 请在此添加自己的节点。",
      "Tokyo = http, existing.example.com, 8080",
    );
    const conflictingNodes = nodes.map((node, index) => ({
      ...node,
      name: index === 0 ? "Tokyo" : "OpenAI",
    }));

    const profile = mergeSurgeTemplate(conflictingTemplate, conflictingNodes, {
      autoSelect: false,
    });

    expect(profile).toContain("Tokyo (2) = ss");
    expect(profile).toContain("OpenAI (2) = ss");
    expect(profile).toContain("代理 = select, Tokyo (2), OpenAI (2), DIRECT");
  });

  it("rejects a template without the required policy group", () => {
    expect(() =>
      mergeSurgeTemplate(
        template.replace("代理 = select, DIRECT", "Other = select, DIRECT"),
        nodes,
        {
          autoSelect: true,
        },
      ),
    ).toThrowError(new TemplateMergeError("模板中缺少“代理”策略组"));
  });

  it("rejects an empty node list", () => {
    expect(() =>
      mergeSurgeTemplate(template, [], { autoSelect: true }),
    ).toThrowError(new TemplateMergeError("没有可合并的 Shadowsocks 节点"));
  });

  it("does not duplicate an existing LinkModel direct rule", () => {
    const existingRuleTemplate = template.replace(
      "[Rule]",
      "[Rule]\nDOMAIN-SUFFIX,linkmodel.ai,DIRECT,extended-matching",
    );

    const profile = mergeSurgeTemplate(existingRuleTemplate, nodes, {
      autoSelect: false,
    });

    expect(
      profile.match(/^DOMAIN-SUFFIX,linkmodel\.ai,DIRECT,extended-matching$/gm),
    ).toHaveLength(1);
  });
});
