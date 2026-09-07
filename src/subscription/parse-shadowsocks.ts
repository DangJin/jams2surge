import type { SurgeShadowsocksNode } from "./types";

const SUPPORTED_METHODS = new Set([
  "2022-blake3-aes-128-gcm",
  "2022-blake3-aes-256-gcm",
  "aes-128-gcm",
  "aes-192-gcm",
  "aes-256-gcm",
  "chacha20-ietf-poly1305",
  "xchacha20-ietf-poly1305",
  "rc4",
  "rc4-md5",
  "aes-128-cfb",
  "aes-192-cfb",
  "aes-256-cfb",
  "aes-128-ctr",
  "aes-192-ctr",
  "aes-256-ctr",
  "salsa20",
  "chacha20",
  "chacha20-ietf",
  "none",
]);

export class NodeParseError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NodeParseError";
  }
}

function invalid(message = "Shadowsocks 节点格式无效"): never {
  throw new NodeParseError("invalid-uri", message);
}

function decodeComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return invalid();
  }
}

function decodeBase64Url(value: string): string {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value) || value.length % 4 === 1) {
    return invalid();
  }
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(padded, "base64"));
  } catch {
    return invalid();
  }
}

function parseCredentials(value: string, encoded: boolean): { method: string; password: string } {
  const credentials = encoded ? decodeBase64Url(value) : value;
  const separator = credentials.indexOf(":");
  if (separator < 1) return invalid();

  const method = decodeComponent(credentials.slice(0, separator)).toLowerCase();
  const password = decodeComponent(credentials.slice(separator + 1));
  if (!password && method !== "none") return invalid("Shadowsocks 密码不能为空");
  if (!SUPPORTED_METHODS.has(method)) {
    throw new NodeParseError("unsupported-method", "Surge 不支持此 Shadowsocks 加密方式");
  }
  return { method, password };
}

function parseHostPort(value: string): { host: string; port: number } {
  const ipv6 = /^\[([^\]]+)]:(\d+)$/.exec(value);
  const separator = value.lastIndexOf(":");
  const host = ipv6?.[1] ?? (separator > 0 ? value.slice(0, separator) : "");
  const portText = ipv6?.[2] ?? (separator > 0 ? value.slice(separator + 1) : "");
  const port = Number(portText);
  if (!host || !/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65_535) {
    return invalid("Shadowsocks 主机或端口无效");
  }
  return { host, port };
}

function parsePlugin(plugin: string | null): Pick<SurgeShadowsocksNode, "obfs" | "obfsHost"> {
  if (!plugin) return {};

  const [command, ...options] = plugin.split(";");
  if (command !== "obfs-local" && command !== "simple-obfs") {
    throw new NodeParseError("unsupported-plugin", "Surge 不支持此 Shadowsocks 插件");
  }

  const values = new Map(options.map((option) => option.split(/=(.*)/s).slice(0, 2) as [string, string]));
  const obfs = values.get("obfs");
  if (obfs !== "http" && obfs !== "tls") {
    throw new NodeParseError("unsupported-plugin", "Surge 不支持此 Shadowsocks 插件");
  }
  const obfsHost = values.get("obfs-host");
  return { obfs, ...(obfsHost ? { obfsHost } : {}) };
}

function parseName(fragment: string, host: string, port: number): string {
  return fragment ? decodeComponent(fragment) : `SS ${host}:${port}`;
}

export function parseShadowsocksUri(uri: string): SurgeShadowsocksNode {
  if (!uri.toLowerCase().startsWith("ss://")) return invalid();

  const raw = uri.slice(5);
  const hashIndex = raw.indexOf("#");
  const fragment = hashIndex >= 0 ? raw.slice(hashIndex + 1) : "";
  const body = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const authorityEnd = body.search(/[/?]/);
  const authority = authorityEnd >= 0 ? body.slice(0, authorityEnd) : body;

  if (authority.includes("@")) {
    let parsed: URL;
    try {
      parsed = new URL(`http://${body}`);
    } catch {
      return invalid();
    }
    const rawUserinfo = authority.slice(0, authority.lastIndexOf("@"));
    const credentials = parseCredentials(rawUserinfo, !rawUserinfo.includes(":"));
    const parsedAddress = parseHostPort(authority.slice(authority.lastIndexOf("@") + 1));
    const host = parsed.hostname.replace(/^\[|]$/g, "");
    const port = parsedAddress.port;
    if (!host) return invalid("Shadowsocks 主机或端口无效");

    return {
      name: parseName(fragment, host, port),
      host,
      port,
      ...credentials,
      udpRelay: true,
      ...parsePlugin(parsed.searchParams.get("plugin")),
    };
  }

  const encodedPayload = body.replace(/\/$/, "");
  const decoded = decodeBase64Url(encodedPayload);
  const at = decoded.lastIndexOf("@");
  if (at < 1) return invalid();
  const credentials = parseCredentials(decoded.slice(0, at), false);
  const { host, port } = parseHostPort(decoded.slice(at + 1));

  return {
    name: parseName(fragment, host, port),
    host,
    port,
    ...credentials,
    udpRelay: true,
  };
}
