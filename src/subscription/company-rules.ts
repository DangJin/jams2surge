export const LINKMODEL_DIRECT_RULE =
  "DOMAIN-SUFFIX,linkmodel.ai,DIRECT,extended-matching";

export function ensureLinkModelDirectRule(
  lines: string[],
  sectionStart: number,
  sectionEnd: number,
): void {
  const existingIndex = lines.findIndex((line, index) => {
    if (index <= sectionStart || index >= sectionEnd) return false;
    const fields = line.split(",").map((field) => field.trim());
    return (
      fields[0]?.toUpperCase() === "DOMAIN-SUFFIX" &&
      fields[1]?.toLowerCase() === "linkmodel.ai" &&
      fields[2]?.toUpperCase() === "DIRECT"
    );
  });

  if (existingIndex >= 0) {
    lines[existingIndex] = LINKMODEL_DIRECT_RULE;
  } else {
    lines.splice(sectionStart + 1, 0, LINKMODEL_DIRECT_RULE);
  }
}
