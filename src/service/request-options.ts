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

export function parseSubscriptionRequest(
  requestUrl: string,
): SubscriptionRequestOptions {
  const params = new URL(requestUrl).searchParams;
  const upstreamUrl = params.get("url");
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
