export const ALIBABA_DIRECT_DOMAINS = [
  "1688.com",
  "aliapp.org",
  "alibaba.com",
  "alibabachengdun.com",
  "alibabacloud.com",
  "alibabausercontent.com",
  "alicdn.com",
  "alicloudccp.com",
  "aliexpress.com",
  "aliimg.com",
  "alikunlun.com",
  "alipay.com",
  "alipayobjects.com",
  "alisoft.com",
  "aliyun.com",
  "aliyuncdn.com",
  "aliyuncs.com",
  "aliyundrive.com",
  "aliyundrive.net",
  "amap.com",
  "autonavi.com",
  "dingtalk.com",
  "ele.me",
  "elemecdn.com",
  "hichina.com",
  "mmstat.com",
  "mxhichina.com",
  "qwen.ai",
  "soku.com",
  "taobao.com",
  "taobaocdn.com",
  "tbcache.com",
  "tbcdn.cn",
  "tbcdn.com",
  "tmall.com",
  "tmall.hk",
  "ucweb.com",
  "xiami.com",
  "xiami.net",
  "ykimg.com",
  "youku.com",
] as const;

const COMPANY_DIRECT_DOMAINS = ["linkmodel.ai", ...ALIBABA_DIRECT_DOMAINS];

export const COMPANY_DIRECT_RULES = COMPANY_DIRECT_DOMAINS.map(
  (domain) => `DOMAIN-SUFFIX,${domain},DIRECT,extended-matching`,
);

function isCompanyDirectRule(line: string): boolean {
  const fields = line.split(",").map((field) => field.trim());
  const domain = fields[1]?.replace(/^"(.*)"$/, "$1").toLowerCase() ?? "";
  return (
    fields[0]?.toUpperCase() === "DOMAIN-SUFFIX" &&
    COMPANY_DIRECT_DOMAINS.includes(domain) &&
    fields[2]?.toUpperCase() === "DIRECT"
  );
}

export function ensureCompanyDirectRules(
  lines: string[],
  sectionStart: number,
  sectionEnd: number,
): void {
  for (let index = sectionEnd - 1; index > sectionStart; index -= 1) {
    if (isCompanyDirectRule(lines[index] ?? "")) lines.splice(index, 1);
  }

  lines.splice(sectionStart + 1, 0, ...COMPANY_DIRECT_RULES);
}
