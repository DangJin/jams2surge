import { decodeSubscription } from "./decode";
import { NodeParseError, parseShadowsocksUri } from "./parse-shadowsocks";
import type { ConversionIssue, ConversionResult, SurgeShadowsocksNode } from "./types";

const VLESS_TRANSPORTS = new Set(["tcp", "kcp", "ws", "http", "grpc", "httpupgrade", "xhttp"]);
const VLESS_SECURITIES = new Set(["none", "tls", "reality"]);

function sanitizeName(value: string, fallback: string): string {
  const sanitized = value
    .replace(/[\u0000-\u001f\u007f,=]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized || fallback;
}

function decodeFragment(hash: string): string | undefined {
  if (!hash) return undefined;
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return undefined;
  }
}

function summarizeVless(uri: string, index: number): ConversionIssue {
  try {
    const parsed = new URL(uri);
    const rawTransport = parsed.searchParams.get("type")?.toLowerCase() ?? "unknown";
    const rawSecurity = parsed.searchParams.get("security")?.toLowerCase() ?? "unknown";
    const transport = VLESS_TRANSPORTS.has(rawTransport) ? rawTransport : "unknown";
    const security = VLESS_SECURITIES.has(rawSecurity) ? rawSecurity : "unknown";
    const fragment = decodeFragment(parsed.hash);

    return {
      index,
      name: sanitizeName(fragment ?? "", `VLESS Node ${index}`),
      protocol: "vless",
      kind: "unsupported",
      message: `Surge 不原生支持 VLESS（${transport}/${security}）`,
    };
  } catch {
    return {
      index,
      name: `VLESS Node ${index}`,
      protocol: "vless",
      kind: "invalid",
      message: "VLESS 节点格式无效",
    };
  }
}

function uniqueNodeName(name: string, index: number, usedNames: Set<string>): string {
  const base = sanitizeName(name, `SS Node ${index}`);
  let candidate = base;
  let suffix = 2;
  while (usedNames.has(candidate)) {
    candidate = `${base} (${suffix})`;
    suffix += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

export function convertSubscriptionText(input: string): ConversionResult {
  const entries = decodeSubscription(input);
  const nodes: SurgeShadowsocksNode[] = [];
  const issues: ConversionIssue[] = [];
  const usedNames = new Set<string>();

  entries.forEach((entry, offset) => {
    const index = offset + 1;
    const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(entry)?.[1]?.toLowerCase();

    if (scheme === "ss") {
      try {
        const node = parseShadowsocksUri(entry);
        nodes.push({ ...node, name: uniqueNodeName(node.name, index, usedNames) });
      } catch (error) {
        issues.push({
          index,
          protocol: "ss",
          kind: error instanceof NodeParseError && error.code.startsWith("unsupported") ? "unsupported" : "invalid",
          message: error instanceof NodeParseError ? error.message : "Shadowsocks 节点格式无效",
        });
      }
      return;
    }

    if (scheme === "vless") {
      issues.push(summarizeVless(entry, index));
      return;
    }

    issues.push({
      index,
      protocol: "unknown",
      kind: "unsupported",
      message: "不支持此节点协议",
    });
  });

  return { nodes, issues };
}
