import type { SurgeShadowsocksNode } from "./types";

const JMS_PROXY_DOMAIN = "portablesubmarines.com";

const JMS_DNS_SERVER = "223.5.5.5";

function collectJmsProxyHostnames(nodes: SurgeShadowsocksNode[]): string[] {
  return [
    ...new Set(
      nodes.flatMap((node) => {
        const host = node.host.toLowerCase().replace(/\.$/, "");
        return host === JMS_PROXY_DOMAIN ||
          host.endsWith(`.${JMS_PROXY_DOMAIN}`)
          ? [host]
          : [];
      }),
    ),
  ];
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
  const mappings = collectJmsProxyHostnames(nodes).map(
    (host) => `${host} = server:${JMS_DNS_SERVER}`,
  );
  if (mappings.length === 0) return;

  const hostStart = findSection(lines, "Host");
  if (hostStart < 0) {
    const ruleStart = findSection(lines, "Rule");
    const insertAt = ruleStart < 0 ? lines.length : ruleStart;
    const section = ["[Host]", ...mappings, ""];
    if (insertAt > 0 && lines[insertAt - 1].trim() !== "") {
      section.unshift("");
    }
    lines.splice(insertAt, 0, ...section);
    return;
  }

  const hostEnd = findSectionEnd(lines, hostStart);
  const mappingPattern =
    /^\s*(?:\*\.)?(?:[a-z0-9-]+\.)*portablesubmarines\.com\s*=/i;
  const matches: number[] = [];
  for (let index = hostStart + 1; index < hostEnd; index += 1) {
    if (mappingPattern.test(lines[index])) matches.push(index);
  }

  if (matches.length > 0) {
    const insertAt = matches[0];
    for (const index of matches.reverse()) lines.splice(index, 1);
    lines.splice(insertAt, 0, ...mappings);
    return;
  }

  let insertAt = hostEnd;
  while (insertAt > hostStart + 1 && lines[insertAt - 1].trim() === "") {
    insertAt -= 1;
  }
  lines.splice(insertAt, 0, ...mappings);
}
