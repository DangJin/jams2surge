import { describe, expect, it } from "vitest";

import { convertSubscriptionText } from "../src/subscription/convert";

function sip002(
  method: string,
  password: string,
  host: string,
  port: number,
  name: string,
): string {
  const credentials = Buffer.from(`${method}:${password}`, "utf8").toString(
    "base64url",
  );
  return `ss://${credentials}@${host}:${port}#${encodeURIComponent(name)}`;
}

describe("convertSubscriptionText", () => {
  it("keeps valid siblings while safely reporting invalid, VLESS, and unknown entries", () => {
    const input = [
      sip002("aes-256-gcm", "secret-1", "one.example", 443, "Tokyo"),
      sip002("aes-128-gcm", "secret-2", "two.example", 8443, "Tokyo"),
      "ss://not-a-valid-node",
      "vless://11111111-1111-1111-1111-111111111111@v.example:443?type=ws&security=tls&pbk=sensitive-public-key#VLESS%20Tokyo",
      "trojan://secret@example.com:443#Unknown",
    ].join("\n");

    const result = convertSubscriptionText(input);

    expect(result.nodes.map((node) => node.name)).toEqual([
      "Tokyo",
      "Tokyo (2)",
    ]);
    expect(result.issues.map((issue) => issue.protocol)).toEqual([
      "ss",
      "vless",
      "unknown",
    ]);
    expect(result.issues[1]).toMatchObject({
      name: "VLESS Tokyo",
      protocol: "vless",
      kind: "unsupported",
      message: "Surge 不原生支持 VLESS（ws/tls）",
    });
    expect(JSON.stringify(result.issues)).not.toContain(
      "11111111-1111-1111-1111-111111111111",
    );
    expect(JSON.stringify(result.issues)).not.toContain("sensitive-public-key");
  });

  it("sanitizes unsafe policy-name separators and deduplicates the sanitized names", () => {
    const input = [
      sip002("aes-128-gcm", "one", "one.example", 80, "Tokyo,=\nNode"),
      sip002("aes-128-gcm", "two", "two.example", 80, "Tokyo   Node"),
    ].join("\n");

    expect(
      convertSubscriptionText(input).nodes.map((node) => node.name),
    ).toEqual(["Tokyo Node", "Tokyo Node (2)"]);
  });

  it("uses a safe fallback when a VLESS fragment is missing or malformed", () => {
    const result = convertSubscriptionText(
      "vless://private-id@example.com:443?type=tcp&security=reality&pbk=private-key",
    );

    expect(result.nodes).toEqual([]);
    expect(result.issues).toEqual([
      {
        index: 1,
        name: "VLESS Node 1",
        protocol: "vless",
        kind: "unsupported",
        message: "Surge 不原生支持 VLESS（tcp/reality）",
      },
    ]);
  });
});
