import type { SurgeShadowsocksNode } from "./types";

const JMS_PROXY_DOMAIN = "portablesubmarines.com";

export const JMS_DNS_BOOTSTRAP_MAPPING =
  "*.portablesubmarines.com = server:223.5.5.5";

function usesJmsProxyHostname(nodes: SurgeShadowsocksNode[]): boolean {
  return nodes.some((node) => {
    const host = node.host.toLowerCase().replace(/\.$/, "");
    return host === JMS_PROXY_DOMAIN || host.endsWith(`.${JMS_PROXY_DOMAIN}`);
  });
}

function findSection(lines: string[], name: string): number {
  return lines.findIndex(
    (line) => line.trim().toLowerCase() === `[${name.toLowerCase()}]`,
  );
}

function findSectionEnd(lines: string[], start: number): number {
  const offset = lines
    .slice(start + 1)
    .findIndex((line) => /^\s*\[[^\]]+]\s*$/.test(line));
  return offset < 0 ? lines.length : start + offset + 1;
}

export function ensureJmsDnsBootstrap(
  lines: string[],
  nodes: SurgeShadowsocksNode[],
): void {
  if (!usesJmsProxyHostname(nodes)) return;

  const hostStart = findSection(lines, "Host");
  if (hostStart < 0) {
    const ruleStart = findSection(lines, "Rule");
    const insertAt = ruleStart < 0 ? lines.length : ruleStart;
    const section = ["[Host]", JMS_DNS_BOOTSTRAP_MAPPING, ""];
    if (insertAt > 0 && lines[insertAt - 1].trim() !== "") {
      section.unshift("");
    }
    lines.splice(insertAt, 0, ...section);
    return;
  }

  const hostEnd = findSectionEnd(lines, hostStart);
  const mappingPattern = /^\s*\*\.portablesubmarines\.com\s*=/i;
  const matches: number[] = [];
  for (let index = hostStart + 1; index < hostEnd; index += 1) {
    if (mappingPattern.test(lines[index])) matches.push(index);
  }

  if (matches.length > 0) {
    lines[matches[0]] = JMS_DNS_BOOTSTRAP_MAPPING;
    for (const index of matches.slice(1).reverse()) lines.splice(index, 1);
    return;
  }

  let insertAt = hostEnd;
  while (insertAt > hostStart + 1 && lines[insertAt - 1].trim() === "") {
    insertAt -= 1;
  }
  lines.splice(insertAt, 0, JMS_DNS_BOOTSTRAP_MAPPING);
}
