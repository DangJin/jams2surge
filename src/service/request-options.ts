export type OutputMode = "template" | "minimal";

export interface SubscriptionRequestOptions {
  upstreamUrl: string;
  mode: OutputMode;
  autoSelect: boolean;
}

export class RequestOptionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestOptionsError";
  }
}

export function encodeSubscriptionSource(upstreamUrl: string): string {
  return Buffer.from(upstreamUrl, "utf8").toString("base64url");
}

function decodeSubscriptionSource(source: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(source) || source.length % 4 === 1) {
    throw new RequestOptionsError("上游订阅地址无效");
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.from(source, "base64url"),
    );
  } catch {
    throw new RequestOptionsError("上游订阅地址无效");
  }
}

export function parseSubscriptionRequest(
  requestUrl: string,
): SubscriptionRequestOptions {
  const params = new URL(requestUrl).searchParams;
  const source = params.get("source");
  const upstreamUrl = source
    ? decodeSubscriptionSource(source)
    : params.get("url");
  if (!upstreamUrl) throw new RequestOptionsError("缺少上游订阅地址");

  const rawMode = params.get("mode") ?? "template";
  if (rawMode !== "template" && rawMode !== "minimal") {
    throw new RequestOptionsError("输出模式无效");
  }

  const rawAutoSelect = params.get("autoSelect") ?? "1";
  if (rawAutoSelect !== "1" && rawAutoSelect !== "0") {
    throw new RequestOptionsError("自动选择参数无效");
  }

  return {
    upstreamUrl,
    mode: rawMode,
    autoSelect: rawAutoSelect === "1",
  };
}
