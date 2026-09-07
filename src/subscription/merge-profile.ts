import { ensureLinkModelDirectRule } from "./company-rules";
import { generateSurgeProxyLine } from "./generate-profile";
import type { SurgeShadowsocksNode } from "./types";

export class TemplateMergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateMergeError";
  }
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

function collectPolicyNames(
  lines: string[],
  start: number,
  end: number,
): string[] {
  return lines.slice(start + 1, end).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//"))
      return [];
    const separator = trimmed.indexOf("=");
    return separator > 0 ? [trimmed.slice(0, separator).trim()] : [];
  });
}

function uniqueName(base: string, usedNames: Set<string>): string {
  let candidate = base;
  let suffix = 2;
  while (usedNames.has(candidate)) {
    candidate = `${base} (${suffix})`;
    suffix += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

export function mergeSurgeTemplate(
  template: string,
  nodes: SurgeShadowsocksNode[],
  options: { autoSelect: boolean },
): string {
  if (nodes.length === 0)
    throw new TemplateMergeError("没有可合并的 Shadowsocks 节点");

  const lines = template
    .replace(/\r\n?/g, "\n")
    .replace(/\n+$/, "")
    .split("\n");
  const proxyStart = findSection(lines, "Proxy");
  const proxyGroupStart = findSection(lines, "Proxy Group");
  if (proxyStart < 0)
    throw new TemplateMergeError("模板中缺少 [Proxy] section");
  if (proxyGroupStart < 0)
    throw new TemplateMergeError("模板中缺少 [Proxy Group] section");

  const proxyEnd = findSectionEnd(lines, proxyStart);
  const proxyGroupEnd = findSectionEnd(lines, proxyGroupStart);
  const usedNames = new Set([
    ...collectPolicyNames(lines, proxyStart, proxyEnd),
    ...collectPolicyNames(lines, proxyGroupStart, proxyGroupEnd),
  ]);
  const mergedNodes = nodes.map((node) => ({
    ...node,
    name: uniqueName(node.name, usedNames),
  }));

  lines.splice(proxyEnd, 0, ...mergedNodes.map(generateSurgeProxyLine));

  const updatedProxyGroupStart = findSection(lines, "Proxy Group");
  const updatedProxyGroupEnd = findSectionEnd(lines, updatedProxyGroupStart);
  const primaryGroupLine = lines.findIndex(
    (line, index) =>
      index > updatedProxyGroupStart &&
      index < updatedProxyGroupEnd &&
      /^\s*代理\s*=/.test(line),
  );
  if (primaryGroupLine < 0)
    throw new TemplateMergeError("模板中缺少“代理”策略组");

  const nodeNames = mergedNodes.map((node) => node.name);
  if (options.autoSelect) {
    const automaticGroupName = uniqueName("自动选择", usedNames);
    lines[primaryGroupLine] =
      `代理 = select, ${automaticGroupName}, ${nodeNames.join(", ")}, DIRECT`;
    lines.splice(
      primaryGroupLine,
      0,
      `${automaticGroupName} = url-test, ${nodeNames.join(", ")}, url=http://www.gstatic.com/generate_204, interval=600, tolerance=100`,
    );
  } else {
    lines[primaryGroupLine] = `代理 = select, ${nodeNames.join(", ")}, DIRECT`;
  }

  const ruleStart = findSection(lines, "Rule");
  if (ruleStart < 0) throw new TemplateMergeError("模板中缺少 [Rule] section");
  ensureLinkModelDirectRule(lines, ruleStart, findSectionEnd(lines, ruleStart));

  return `${lines.join("\n")}\n`;
}
