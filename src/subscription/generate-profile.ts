import type { SurgeShadowsocksNode } from "./types";
import { COMPANY_DIRECT_RULES } from "./company-rules";
import { ensureJmsDnsBootstrap } from "./jms-dns";

export class ProfileGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileGenerationError";
  }
}

function formatValue(value: string): string {
  const safe = value.replace(/[\r\n]/g, "");
  if (!/[,"\\]/.test(safe) && !/^\s|\s$/.test(safe)) {
    return safe;
  }
  return `"${safe.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function generateSurgeProxyLine(node: SurgeShadowsocksNode): string {
  const parameters = [
    `encrypt-method=${formatValue(node.method)}`,
    `password=${formatValue(node.password)}`,
    `udp-relay=${node.udpRelay}`,
  ];
  if (node.obfs) parameters.push(`obfs=${node.obfs}`);
  if (node.obfsHost) parameters.push(`obfs-host=${formatValue(node.obfsHost)}`);

  return `${node.name} = ss, ${formatValue(node.host)}, ${node.port}, ${parameters.join(", ")}`;
}

export function generateSurgeProfile(nodes: SurgeShadowsocksNode[]): string {
  if (nodes.length === 0) {
    throw new ProfileGenerationError("没有可转换的 Shadowsocks 节点");
  }

  const lines = [
    "[General]",
    "loglevel = notify",
    "",
    "[Proxy]",
    ...nodes.map(generateSurgeProxyLine),
    "",
    "[Proxy Group]",
    `Proxy = select, ${nodes.map((node) => node.name).join(", ")}, DIRECT`,
    "",
    "[Rule]",
    ...COMPANY_DIRECT_RULES,
    "FINAL,Proxy",
    "",
  ];
  ensureJmsDnsBootstrap(lines, nodes);
  return lines.join("\n");
}
