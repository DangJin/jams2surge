import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export class UnsafeUpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUpstreamError";
  }
}

const systemResolver: Resolver = async (hostname) => {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map(({ address, family }) => {
    if (family !== 4 && family !== 6) {
      throw new UnsafeUpstreamError("上游订阅地址不能指向本地或内网");
    }
    return { address, family };
  });
};

const ipv6GlobalUnicastPrefix = ipaddr.IPv6.parse("2000::");

export function isPublicIpAddress(value: string): boolean {
  if (!ipaddr.isValid(value)) return false;

  const address = ipaddr.parse(value);
  if (address instanceof ipaddr.IPv6 && address.isIPv4MappedAddress()) {
    return address.toIPv4Address().range() === "unicast";
  }
  if (address instanceof ipaddr.IPv6) {
    return (
      address.range() === "unicast" && address.match(ipv6GlobalUnicastPrefix, 3)
    );
  }

  return address.range() === "unicast";
}

export function validateUpstreamUrl(value: string): URL {
  const url = new URL(value);

  if (url.protocol !== "https:") {
    throw new UnsafeUpstreamError("上游订阅地址必须使用 HTTPS");
  }
  if (url.username || url.password) {
    throw new UnsafeUpstreamError("上游订阅地址不能包含凭据");
  }
  if (url.port && url.port !== "443") {
    throw new UnsafeUpstreamError("上游订阅地址只能使用 443 端口");
  }

  const hostname = normalizeHostname(url.hostname);
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    (ipaddr.isValid(hostname) && !isPublicIpAddress(hostname))
  ) {
    throw new UnsafeUpstreamError("上游订阅地址不能指向本地或内网");
  }

  return url;
}

export async function resolvePublicAddresses(
  hostname: string,
  resolver: Resolver = systemResolver,
): Promise<ResolvedAddress[]> {
  const addresses = await resolver(hostname);
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublicIpAddress(address))
  ) {
    throw new UnsafeUpstreamError("上游订阅地址不能指向本地或内网");
  }

  return addresses;
}

function normalizeHostname(hostname: string): string {
  const withoutBrackets =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;

  return withoutBrackets.replace(/\.$/, "").toLowerCase();
}
