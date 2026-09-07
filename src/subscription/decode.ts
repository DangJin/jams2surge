export class SubscriptionDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubscriptionDecodeError";
  }
}

const RECOGNIZED_URI = /\b(?:ss|vless):\/\//i;

function normalizeText(input: string): string {
  return input
    .trim()
    .replace(/^\uFEFF/, "")
    .trim();
}

function extractLines(input: string): string[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function decodeBase64Utf8(input: string): string | undefined {
  const compact = input.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(compact) || compact.length % 4 === 1) {
    return undefined;
  }

  const normalized = compact
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/=+$/, "");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

  try {
    const bytes = Buffer.from(padded, "base64");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

export function decodeSubscription(input: string): string[] {
  const normalized = normalizeText(input);
  if (!normalized) {
    throw new SubscriptionDecodeError("订阅内容为空");
  }

  if (RECOGNIZED_URI.test(normalized)) {
    return extractLines(normalized);
  }

  const decoded = decodeBase64Utf8(normalized);
  if (decoded) {
    const normalizedDecoded = normalizeText(decoded);
    if (RECOGNIZED_URI.test(normalizedDecoded)) {
      return extractLines(normalizedDecoded);
    }
  }

  throw new SubscriptionDecodeError("无法识别订阅格式");
}
