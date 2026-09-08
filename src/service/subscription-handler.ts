import { convertSubscriptionText } from "../subscription/convert";
import { generateSurgeProfile } from "../subscription/generate-profile";
import {
  parseSubscriptionRequest,
  RequestOptionsError,
} from "./request-options";
import {
  downloadPublicHttpsText,
  SafeDownloadError,
} from "./safe-download";

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const RESPONSE_HEADERS = {
  "content-type": "text/plain; charset=utf-8",
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};

export interface SubscriptionHandlerDependencies {
  downloadText: (url: string) => Promise<string>;
  templateUrl: string;
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

export function createSubscriptionHandler(
  dependencies: Partial<SubscriptionHandlerDependencies> = {},
): (request: Request) => Promise<Response> {
  const downloadText = dependencies.downloadText ?? downloadPublicHttpsText;

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
      const upstream = await downloadText(options.upstreamUrl);
      const result = convertSubscriptionText(upstream);
      if (result.nodes.length === 0) {
        return textResponse("没有可转换的 Shadowsocks 节点", 422);
      }

      const profile = generateSurgeProfile(result.nodes);
      if (new TextEncoder().encode(profile).byteLength > MAX_RESPONSE_BYTES) {
        return textResponse("生成的 Surge 配置超过大小限制", 502);
      }
      return textResponse(profile, 200);
    } catch (error) {
      if (error instanceof SafeDownloadError) {
        return textResponse(
          error.code === "timeout"
            ? "上游订阅下载超时"
            : "上游订阅下载失败",
          error.code === "timeout" ? 504 : 502,
        );
      }
      return textResponse("在线订阅转换失败", 502);
    }
  };
}
