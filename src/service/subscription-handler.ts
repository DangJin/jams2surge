import { convertSubscriptionText } from "../subscription/convert";
import { ALIBABA_DIRECT_DOMAINS } from "../subscription/company-rules";
import { generateSurgeProfile } from "../subscription/generate-profile";
import { mergeSurgeTemplate } from "../subscription/merge-profile";
import {
  encodeSubscriptionSource,
  parseSubscriptionRequest,
  RequestOptionsError,
} from "./request-options";
import { downloadPublicHttpsText, SafeDownloadError } from "./safe-download";

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const SURGE_TEMPLATE_URL =
  "https://raw.githubusercontent.com/iFaNGMiNGi/Surge-Config/main/Surge-Mac.conf";
const RESPONSE_HEADERS = {
  "content-type": "text/plain; charset=utf-8",
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};
const ALIBABA_DIRECT_RULES = new Set(
  ALIBABA_DIRECT_DOMAINS.map(
    (domain) => `DOMAIN-SUFFIX,${domain},DIRECT,extended-matching`,
  ),
);

export interface SubscriptionHandlerDependencies {
  downloadText: (url: string) => Promise<string>;
  templateUrl: string;
}

type DownloadSource = "upstream" | "template";

class DownloadFailure {
  constructor(
    readonly source: DownloadSource,
    readonly cause: unknown,
  ) {}
}

async function downloadFrom(
  downloadText: (url: string) => Promise<string>,
  url: string,
  source: DownloadSource,
): Promise<string> {
  try {
    return await downloadText(url);
  } catch (error) {
    throw new DownloadFailure(source, error);
  }
}

function textResponse(
  body: string,
  status: number,
  extra?: ConstructorParameters<typeof Headers>[0],
) {
  return new Response(body, {
    status,
    headers: {
      ...RESPONSE_HEADERS,
      ...Object.fromEntries(new Headers(extra)),
    },
  });
}

function compactAlibabaRules(profile: string, requestUrl: string): string {
  const domainSetUrl = new URL("/alibaba-domains.list", requestUrl).toString();
  const domainSetRule = `DOMAIN-SET,${domainSetUrl},DIRECT,extended-matching`;
  let inserted = false;

  return profile
    .split("\n")
    .flatMap((line) => {
      if (!ALIBABA_DIRECT_RULES.has(line)) return [line];
      if (inserted) return [];
      inserted = true;
      return [domainSetRule];
    })
    .join("\n");
}

export function createSubscriptionHandler(
  dependencies: Partial<SubscriptionHandlerDependencies> = {},
): (request: Request) => Promise<Response> {
  const downloadText = dependencies.downloadText ?? downloadPublicHttpsText;
  const templateUrl = dependencies.templateUrl ?? SURGE_TEMPLATE_URL;

  return async (request) => {
    if (request.method !== "GET") {
      return textResponse("仅支持 GET 请求", 405, { Allow: "GET" });
    }

    let options;
    try {
      options = parseSubscriptionRequest(request.url);
    } catch (error) {
      if (error instanceof RequestOptionsError) {
        return textResponse(error.message, 400);
      }
      return textResponse("请求参数无效", 400);
    }

    try {
      const [upstream, template] = await Promise.all([
        downloadFrom(downloadText, options.upstreamUrl, "upstream"),
        ...(options.mode === "template"
          ? [downloadFrom(downloadText, templateUrl, "template")]
          : []),
      ]);
      const result = convertSubscriptionText(upstream);
      if (result.nodes.length === 0) {
        return textResponse("没有可转换的 Shadowsocks 节点", 422);
      }

      const generatedProfile =
        options.mode === "template"
          ? mergeSurgeTemplate(template!, result.nodes, {
              autoSelect: options.autoSelect,
            })
          : generateSurgeProfile(result.nodes);
      const profile = compactAlibabaRules(generatedProfile, request.url);
      const managedUrl = new URL(request.url);
      managedUrl.search = "";
      managedUrl.searchParams.set(
        "source",
        encodeSubscriptionSource(options.upstreamUrl),
      );
      managedUrl.searchParams.set("mode", options.mode);
      managedUrl.searchParams.set("autoSelect", options.autoSelect ? "1" : "0");
      const managedProfile =
        `#!MANAGED-CONFIG ${managedUrl.toString()} interval=86400 strict=true\n` +
        profile;
      if (
        new TextEncoder().encode(managedProfile).byteLength > MAX_RESPONSE_BYTES
      ) {
        return textResponse("生成的 Surge 配置超过大小限制", 502);
      }
      return textResponse(managedProfile, 200);
    } catch (error) {
      const downloadFailure =
        error instanceof DownloadFailure ? error : undefined;
      const cause = downloadFailure?.cause ?? error;
      if (cause instanceof SafeDownloadError) {
        if (
          downloadFailure?.source === "upstream" &&
          (cause.code === "invalid" || cause.code === "unsafe")
        ) {
          return textResponse("上游订阅地址无效", 400);
        }
        return textResponse(
          cause.code === "timeout" ? "上游订阅下载超时" : "上游订阅下载失败",
          cause.code === "timeout" ? 504 : 502,
        );
      }
      return textResponse("在线订阅转换失败", 502);
    }
  };
}
