# Jams2Surge Vercel Online Subscription Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a stateless Vercel endpoint and browser-only URL generator that transform a URL-encoded upstream subscription into a fresh Surge profile on every request while preserving the Raycast extension.

**Architecture:** Keep `src/subscription` as the framework-independent conversion core. Add a small service layer for HTTP option parsing and SSRF-safe HTTPS downloads, expose it through one Vercel Web Handler, and serve a dependency-free static generator page from `public/`.

**Tech Stack:** TypeScript 6, Node.js 22 built-in HTTPS/DNS APIs, Vercel Functions Web Handler, Vitest 5, `ipaddr.js`, browser-native HTML/CSS/ES modules

**Spec:** `docs/superpowers/specs/2026-09-08-jams2surge-vercel-service-design.md`

## Global Constraints

- The online service is stateless: no Next.js, Redis, Blob, database, login, server session, persistent cache, or generated-link registry.
- The public contract is `GET /api/subscription?url=<encoded-url>&mode=template|minimal&autoSelect=1|0`.
- `mode` defaults to `template`; `autoSelect` defaults to `1` and only affects template mode.
- User-provided upstream URLs must use HTTPS, contain no credentials, use port 443/default, resolve only to public IP addresses, and pass the same checks after every redirect.
- Outbound connections must use the DNS result that was checked, preventing a second unvalidated resolution before connection.
- Follow at most 3 redirects; allow at most 15 seconds and 4 MiB per download and 4 MiB for the generated profile.
- Success and error responses use `Cache-Control: private, no-store` and must not expose the complete upstream URL, subscription body, proxy credentials, or stack trace.
- Preserve the Raycast extension and all current conversion behavior, including LinkModel and 41 Alibaba direct-domain rules.
- All production behavior is implemented through red-green-refactor TDD.

---

## File Structure

### Existing files to modify

- `package.json`: add `ipaddr.js`, its types if required, and a Vercel build-check script without changing the Raycast `build` script.
- `package-lock.json`: lock the new dependencies.
- `README.md`: document Vercel deployment, endpoint parameters, privacy trade-offs, and examples.
- `src/subscription/fetch.ts`: keep Raycast behavior intact; only extract shared byte-decoding helpers if the safe downloader needs them.

### Production files to create

- `src/service/request-options.ts`: parse and validate the endpoint query contract.
- `src/service/public-address.ts`: classify literal and resolved IPv4/IPv6 addresses.
- `src/service/safe-download.ts`: perform pinned-DNS HTTPS downloads with redirect, timeout, UTF-8, and byte limits.
- `src/service/subscription-handler.ts`: orchestrate download, conversion, template selection, error mapping, and response headers.
- `api/subscription.ts`: thin Vercel Web Handler adapter.
- `public/index.html`: static URL generator interface.
- `public/styles.css`: local styles only.
- `public/generate-url.mjs`: browser-side query URL generation with no network call.
- `vercel.json`: Vercel build and Function duration configuration.

### Test files to create

- `tests/request-options.test.ts`: endpoint query parsing.
- `tests/public-address.test.ts`: IPv4/IPv6 and hostname safety rules.
- `tests/safe-download.test.ts`: redirects, pinned lookup, timeout, body size, and UTF-8 behavior.
- `tests/subscription-handler.test.ts`: HTTP contract and conversion orchestration.
- `tests/generate-url.test.mjs`: browser URL generation logic.

---

### Task 1: Commit the Approved Company Direct Rules Baseline

**Files:**
- Modify: `README.md:55-68`
- Modify: `src/subscription/company-rules.ts:1-71`
- Modify: `src/subscription/generate-profile.ts:1-51`
- Modify: `src/subscription/merge-profile.ts:1-112`
- Modify: `tests/generate-profile.test.ts:1-86`
- Modify: `tests/merge-profile.test.ts:1-138`
- Create: `tests/fixtures/company-direct-domains.ts`

**Interfaces:**
- Produces: `COMPANY_DIRECT_RULES: string[]`
- Produces: `ensureCompanyDirectRules(lines: string[], sectionStart: number, sectionEnd: number): void`
- Preserves: `generateSurgeProfile()` and `mergeSurgeTemplate()` signatures used by later tasks.

- [ ] **Step 1: Verify the already-completed red-green cycle remains green**

Run:

```bash
npm test -- tests/generate-profile.test.ts tests/merge-profile.test.ts
```

Expected: 11 tests pass, including all 41 approved Alibaba roots and quoted duplicate normalization.

- [ ] **Step 2: Run static checks for the baseline**

Run:

```bash
npm run typecheck
npm run lint
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Commit only the company direct-rule changes**

```bash
git add README.md src/subscription/company-rules.ts src/subscription/generate-profile.ts src/subscription/merge-profile.ts tests/generate-profile.test.ts tests/merge-profile.test.ts tests/fixtures/company-direct-domains.ts
git commit -m "feat(jams2surge): 添加阿里系产品直连规则"
```

Expected: the unrelated `../prompthub/` path remains untracked and unstaged.

---

### Task 2: Parse the Stateless Endpoint Contract

**Files:**
- Create: `src/service/request-options.ts`
- Create: `tests/request-options.test.ts`

**Interfaces:**
- Produces: `type OutputMode = "template" | "minimal"`
- Produces: `interface SubscriptionRequestOptions { upstreamUrl: string; mode: OutputMode; autoSelect: boolean }`
- Produces: `class RequestOptionsError extends Error`
- Produces: `parseSubscriptionRequest(requestUrl: string): SubscriptionRequestOptions`

- [ ] **Step 1: Write failing tests for defaults and explicit values**

```ts
import { describe, expect, it } from "vitest";
import { parseSubscriptionRequest } from "../src/service/request-options";

describe("parseSubscriptionRequest", () => {
  it("uses template mode and automatic selection by default", () => {
    expect(
      parseSubscriptionRequest(
        "https://service.test/api/subscription?url=https%3A%2F%2Fupstream.test%2Fsub%3Ftoken%3Dabc",
      ),
    ).toEqual({
      upstreamUrl: "https://upstream.test/sub?token=abc",
      mode: "template",
      autoSelect: true,
    });
  });

  it("accepts minimal mode with automatic selection disabled", () => {
    expect(
      parseSubscriptionRequest(
        "https://service.test/api/subscription?url=https%3A%2F%2Fupstream.test%2Fsub&mode=minimal&autoSelect=0",
      ),
    ).toEqual({
      upstreamUrl: "https://upstream.test/sub",
      mode: "minimal",
      autoSelect: false,
    });
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npm test -- tests/request-options.test.ts
```

Expected: FAIL because `src/service/request-options.ts` does not exist.

- [ ] **Step 3: Add failing table tests for invalid input**

Add literal cases for a missing/empty `url`, `mode=other`, and `autoSelect=yes`, each expecting a stable safe message:

```ts
it.each([
  ["https://service.test/api/subscription", "缺少上游订阅地址"],
  ["https://service.test/api/subscription?url=", "缺少上游订阅地址"],
  [
    "https://service.test/api/subscription?url=https%3A%2F%2Fupstream.test%2Fsub&mode=other",
    "输出模式无效",
  ],
  [
    "https://service.test/api/subscription?url=https%3A%2F%2Fupstream.test%2Fsub&autoSelect=yes",
    "自动选择参数无效",
  ],
])("rejects invalid request options", (url, message) => {
  expect(() => parseSubscriptionRequest(url)).toThrowError(message);
});
```

- [ ] **Step 4: Implement the minimal parser**

```ts
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
```

- [ ] **Step 5: Run focused and full tests**

```bash
npm test -- tests/request-options.test.ts
npm test
```

Expected: focused tests and the full suite pass.

- [ ] **Step 6: Commit**

```bash
git add src/service/request-options.ts tests/request-options.test.ts
git commit -m "feat(jams2surge): 定义在线订阅请求参数"
```

---

### Task 3: Reject Non-Public Upstream Destinations

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/service/public-address.ts`
- Create: `tests/public-address.test.ts`

**Interfaces:**
- Consumes: `ipaddr.js`
- Produces: `validateUpstreamUrl(value: string): URL`
- Produces: `isPublicIpAddress(value: string): boolean`
- Produces: `resolvePublicAddresses(hostname: string, resolver?: Resolver): Promise<ResolvedAddress[]>`
- Produces: `interface ResolvedAddress { address: string; family: 4 | 6 }`
- Produces: `type Resolver = (hostname: string) => Promise<ResolvedAddress[]>`
- Produces: `class UnsafeUpstreamError extends Error`

- [ ] **Step 1: Install the address parser**

Run:

```bash
npm install ipaddr.js
npm install --save-dev @types/ipaddr.js
```

Expected: `package.json` and `package-lock.json` contain locked dependencies.

- [ ] **Step 2: Write failing literal-IP classification tests**

```ts
it.each([
  "93.184.216.34",
  "2606:2800:220:1:248:1893:25c8:1946",
])("accepts public address %s", (address) => {
  expect(isPublicIpAddress(address)).toBe(true);
});

it.each([
  "0.0.0.0",
  "10.0.0.1",
  "100.64.0.1",
  "127.0.0.1",
  "169.254.169.254",
  "172.16.0.1",
  "192.168.0.1",
  "224.0.0.1",
  "::",
  "::1",
  "fc00::1",
  "fe80::1",
  "ff02::1",
  "::ffff:127.0.0.1",
])("rejects non-public address %s", (address) => {
  expect(isPublicIpAddress(address)).toBe(false);
});
```

- [ ] **Step 3: Run the focused test and verify RED**

```bash
npm test -- tests/public-address.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 4: Add failing URL and resolver tests**

Cover these literal cases:

```ts
expect(() => validateUpstreamUrl("http://example.com/sub")).toThrowError(
  "上游订阅地址必须使用 HTTPS",
);
expect(() => validateUpstreamUrl("https://user:pass@example.com/sub")).toThrowError(
  "上游订阅地址不能包含凭据",
);
expect(() => validateUpstreamUrl("https://example.com:8443/sub")).toThrowError(
  "上游订阅地址只能使用 443 端口",
);
expect(() => validateUpstreamUrl("https://localhost/sub")).toThrowError(
  "上游订阅地址不能指向本地或内网",
);
```

Also inject resolvers returning only public addresses, one private address, an empty list, and a mixed public/private list. The mixed list must be rejected so selection order cannot bypass the policy.

- [ ] **Step 5: Implement public-only classification and resolution**

Use `ipaddr.parse(value).range() === "unicast"` as the acceptance rule. For IPv4-mapped IPv6, call `toIPv4Address()` and classify the embedded IPv4 address. `validateUpstreamUrl` parses once and rejects non-HTTPS URLs, credentials, non-443 ports, `localhost`, `.localhost`, and unsafe IP literals. `resolvePublicAddresses` uses `node:dns/promises.lookup(hostname, { all: true, verbatim: true })` by default and rejects if the result is empty or any result is non-public.

```ts
export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

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
```

- [ ] **Step 6: Run tests and typecheck**

```bash
npm test -- tests/public-address.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/service/public-address.ts tests/public-address.test.ts
git commit -m "feat(jams2surge): 拒绝非公网订阅地址"
```

---

### Task 4: Download HTTPS Content with Pinned DNS and Resource Limits

**Files:**
- Create: `src/service/safe-download.ts`
- Create: `tests/safe-download.test.ts`

**Interfaces:**
- Consumes: `validateUpstreamUrl()`, `resolvePublicAddresses()`, `ResolvedAddress`
- Consumes: Node.js `https.request()` through a small injected `RequestTransport`
- Produces: `downloadPublicHttpsText(value: string, options?: DownloadOptions): Promise<string>`
- Produces: `interface DownloadOptions { timeoutMs?: number; maxBytes?: number; maxRedirects?: number; resolver?: Resolver; transport?: RequestTransport }`
- Produces: `interface TransportResponse { statusCode: number; headers: Record<string, string | string[] | undefined>; body: AsyncIterable<Uint8Array> }`
- Produces: `interface TransportRequest { signal: AbortSignal; addresses: readonly ResolvedAddress[]; headers: Readonly<Record<string, string>> }`
- Produces: `type RequestTransport = (url: URL, request: TransportRequest) => Promise<TransportResponse>`
- Produces: `class SafeDownloadError extends Error` with `code: "invalid" | "unsafe" | "timeout" | "http" | "too-large" | "encoding" | "network" | "redirect"`

- [ ] **Step 1: Write failing success and pinned-address tests**

Create a deterministic fake `RequestTransport` that records the URL, headers, and validated addresses, then returns an async iterable body. Assert:

```ts
expect(await downloadPublicHttpsText("https://upstream.test/sub", deps)).toBe(
  "ss://fixture",
);
expect(resolvedHostnames).toEqual(["upstream.test"]);
expect(transportAddresses).toEqual([[{ address: "93.184.216.34", family: 4 }]]);
expect(forwardedHeaders).not.toHaveProperty("authorization");
expect(forwardedHeaders).not.toHaveProperty("cookie");
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
npm test -- tests/safe-download.test.ts
```

Expected: FAIL because `downloadPublicHttpsText` does not exist.

- [ ] **Step 3: Add failing redirect and failure tests**

Use literal fake responses to cover:

- a 302 from `first.test` to `https://second.test/sub`, with both hostnames resolved and pinned;
- redirect to `http://second.test/sub`, rejected as unsafe;
- a fourth redirect, rejected with `code === "redirect"`;
- HTTP 404, mapped to `code === "http"` without including the URL;
- declared and streamed bodies over 4 MiB, mapped to `too-large`;
- an abort after 15 seconds using fake timers, mapped to `timeout`;
- invalid UTF-8, mapped to `encoding`;
- transport failure, mapped to `network` without leaking the original error message.

- [ ] **Step 4: Implement the bounded downloader**

Implement a loop from redirect count 0 through 3. For each hop:

1. Call `validateUpstreamUrl`.
2. Call `resolvePublicAddresses`.
3. Pass the validated addresses to the transport. The default Node.js transport calls `https.request()` with a custom `lookup` callback that returns the first validated address and never calls system DNS again. Preserve the original hostname in the request URL so TLS SNI and certificate verification still use the hostname.
4. Send only fixed headers: `accept: text/plain,*/*;q=0.1` and a short `user-agent`.
5. Disable automatic redirects; resolve a `Location` header against the current URL and restart the loop.
6. Stream bytes, enforcing `Content-Length` and accumulated byte limits.
7. Decode with `new TextDecoder("utf-8", { fatal: true })`.
8. Destroy the request on abort and remove the timer in `finally`.

Constants:

```ts
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
```

The abort timer covers DNS, connection, headers, and body consumption as one overall deadline per downloaded resource.

- [ ] **Step 5: Run focused and full tests**

```bash
npm test -- tests/safe-download.test.ts tests/public-address.test.ts
npm test
npm run typecheck
```

Expected: all commands pass with no network access.

- [ ] **Step 6: Commit**

```bash
git add src/service/safe-download.ts tests/safe-download.test.ts
git commit -m "feat(jams2surge): 安全下载在线订阅"
```

---

### Task 5: Serve Fresh Minimal Surge Profiles

**Files:**
- Create: `src/service/subscription-handler.ts`
- Create: `tests/subscription-handler.test.ts`

**Interfaces:**
- Consumes: `parseSubscriptionRequest()`
- Consumes: `downloadPublicHttpsText()` through `SubscriptionHandlerDependencies.downloadText`
- Consumes: `convertSubscriptionText()` and `generateSurgeProfile()`
- Produces: `interface SubscriptionHandlerDependencies { downloadText: (url: string) => Promise<string>; templateUrl: string }`
- Produces: `createSubscriptionHandler(dependencies?: Partial<SubscriptionHandlerDependencies>): (request: Request) => Promise<Response>`

- [ ] **Step 1: Write the failing minimal-mode response test**

```ts
it("downloads and converts a fresh minimal profile", async () => {
  const upstreamBodies = [subscriptionWithTokyo, subscriptionWithOsaka];
  const handler = createSubscriptionHandler({
    downloadText: async () => upstreamBodies.shift()!,
  });
  const url =
    "https://service.test/api/subscription?url=https%3A%2F%2Fupstream.test%2Fsub&mode=minimal&autoSelect=0";

  const first = await handler(new Request(url));
  const second = await handler(new Request(url));

  expect(first.status).toBe(200);
  expect(await first.text()).toContain("Tokyo = ss");
  expect(await second.text()).toContain("Osaka = ss");
  expect(first.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(first.headers.get("cache-control")).toBe("private, no-store");
  expect(first.headers.get("x-content-type-options")).toBe("nosniff");
});
```

- [ ] **Step 2: Run the handler test and verify RED**

```bash
npm test -- tests/subscription-handler.test.ts
```

Expected: FAIL because the handler module does not exist.

- [ ] **Step 3: Add failing contract and conversion-error tests**

Add literal assertions for:

- POST returns 405, `Allow: GET`, and never calls `downloadText`;
- missing/invalid parameters return 400;
- zero compatible nodes return 422 with `没有可转换的 Shadowsocks 节点`;
- a `SafeDownloadError` with `timeout` returns 504;
- other safe download failures return 502;
- unexpected errors return `在线订阅转换失败` with status 502;
- every error response contains the no-store and nosniff headers;
- no error body contains `token=abc`, an upstream response fixture, or an injected exception message;
- a generated profile over 4 MiB returns 502 without a partial profile.

- [ ] **Step 4: Implement minimal-mode orchestration and safe responses**

Use one response helper for success and errors:

```ts
const RESPONSE_HEADERS = {
  "content-type": "text/plain; charset=utf-8",
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};

function textResponse(body: string, status: number, extra?: HeadersInit) {
  return new Response(body, {
    status,
    headers: { ...RESPONSE_HEADERS, ...Object.fromEntries(new Headers(extra)) },
  });
}
```

Parse parameters before downloading. In minimal mode, call `downloadText(upstreamUrl)`, `convertSubscriptionText(body)`, reject an empty `nodes` array with 422, call `generateSurgeProfile(nodes)`, enforce the encoded 4 MiB output limit, and return 200.

- [ ] **Step 5: Run focused and full verification**

```bash
npm test -- tests/subscription-handler.test.ts
npm test
npm run typecheck
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/service/subscription-handler.ts tests/subscription-handler.test.ts
git commit -m "feat(jams2surge): 提供最小在线订阅响应"
```

---

### Task 6: Add Template Mode and the Vercel Entry Point

**Files:**
- Modify: `src/service/subscription-handler.ts`
- Modify: `tests/subscription-handler.test.ts`
- Create: `api/subscription.ts`
- Create: `vercel.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: `mergeSurgeTemplate(template, nodes, { autoSelect })`
- Produces: Vercel default export `{ fetch(request: Request): Promise<Response> }`

- [ ] **Step 1: Write failing template-mode tests**

```ts
it.each([
  ["1", "自动选择 = url-test"],
  ["0", "代理 = select, Tokyo, DIRECT"],
])("merges the fixed template with autoSelect=%s", async (flag, expected) => {
  const requested: string[] = [];
  const handler = createSubscriptionHandler({
    templateUrl: "https://template.test/Surge-Mac.conf",
    downloadText: async (url) => {
      requested.push(url);
      return url.includes("template.test") ? templateFixture : subscriptionWithTokyo;
    },
  });

  const response = await handler(
    new Request(
      `https://service.test/api/subscription?url=https%3A%2F%2Fupstream.test%2Fsub&mode=template&autoSelect=${flag}`,
    ),
  );

  expect(response.status).toBe(200);
  expect(await response.text()).toContain(expected);
  expect(requested).toEqual([
    "https://upstream.test/sub",
    "https://template.test/Surge-Mac.conf",
  ]);
});
```

Also assert that `mode=minimal` requests only the upstream URL.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
npm test -- tests/subscription-handler.test.ts
```

Expected: template-mode cases fail because the handler still generates a minimal profile.

- [ ] **Step 3: Implement template selection**

Set the production template constant to:

```ts
const SURGE_TEMPLATE_URL =
  "https://raw.githubusercontent.com/iFaNGMiNGi/Surge-Config/main/Surge-Mac.conf";
```

For template mode, download upstream and template with `Promise.all`, convert the upstream, then call `mergeSurgeTemplate(template, result.nodes, { autoSelect })`. Preserve the existing error mapping and output-size check.

- [ ] **Step 4: Add the thin Vercel adapter and config**

`api/subscription.ts` contains no business logic:

```ts
import { createSubscriptionHandler } from "../src/service/subscription-handler";

const handler = createSubscriptionHandler();

export default {
  fetch(request: Request): Promise<Response> {
    return handler(request);
  },
};
```

Add `vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "npm run build:vercel",
  "functions": {
    "api/subscription.ts": {
      "maxDuration": 20
    }
  }
}
```

Add without changing the existing Raycast build command:

```json
"build:vercel": "tsc --noEmit"
```

- [ ] **Step 5: Run endpoint verification**

```bash
npm test -- tests/subscription-handler.test.ts
npm run build:vercel
npm run build
```

Expected: handler tests, Vercel typecheck, and Raycast build pass.

- [ ] **Step 6: Commit**

```bash
git add src/service/subscription-handler.ts tests/subscription-handler.test.ts api/subscription.ts vercel.json package.json
git commit -m "feat(jams2surge): 增加 Vercel 在线订阅接口"
```

---

### Task 7: Build the Browser-Only URL Generator

**Files:**
- Create: `public/generate-url.mjs`
- Create: `public/index.html`
- Create: `public/styles.css`
- Create: `tests/generate-url.test.mjs`

**Interfaces:**
- Produces: `buildSubscriptionUrl(origin: string, values: { upstreamUrl: string; mode: "template" | "minimal"; autoSelect: boolean }): string`
- Consumed by: `public/index.html` module script.

- [ ] **Step 1: Write the failing URL-generation tests**

```js
import { describe, expect, it } from "vitest";
import { buildSubscriptionUrl } from "../public/generate-url.mjs";

describe("buildSubscriptionUrl", () => {
  it("encodes the nested subscription URL and explicit options", () => {
    const result = buildSubscriptionUrl("https://service.test", {
      upstreamUrl: "https://upstream.test/sub?token=a&user=b",
      mode: "template",
      autoSelect: false,
    });

    const generated = new URL(result);
    expect(generated.pathname).toBe("/api/subscription");
    expect(generated.searchParams.get("url")).toBe(
      "https://upstream.test/sub?token=a&user=b",
    );
    expect(generated.searchParams.get("mode")).toBe("template");
    expect(generated.searchParams.get("autoSelect")).toBe("0");
  });

  it("rejects non-HTTPS upstream URLs", () => {
    expect(() =>
      buildSubscriptionUrl("https://service.test", {
        upstreamUrl: "http://upstream.test/sub",
        mode: "minimal",
        autoSelect: true,
      }),
    ).toThrow("请输入 HTTPS 订阅地址");
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

```bash
npm test -- tests/generate-url.test.mjs
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure generator**

```js
export function buildSubscriptionUrl(origin, values) {
  const upstream = new URL(values.upstreamUrl);
  if (upstream.protocol !== "https:") {
    throw new Error("请输入 HTTPS 订阅地址");
  }
  const result = new URL("/api/subscription", origin);
  result.searchParams.set("url", upstream.toString());
  result.searchParams.set("mode", values.mode);
  result.searchParams.set("autoSelect", values.autoSelect ? "1" : "0");
  return result.toString();
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

```bash
npm test -- tests/generate-url.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Create the static page and local styles**

Create a single-column form with semantic labels for upstream URL, output mode, and automatic selection. Import `buildSubscriptionUrl` from `./generate-url.mjs`. On submit, generate the URL into a read-only textarea. Disable the automatic-selection checkbox when minimal mode is selected. The copy button calls `navigator.clipboard.writeText(result.value)` and displays a textual success/failure status in an `aria-live="polite"` region.

The page must visibly include this warning:

```text
生成地址包含原始订阅链接。请勿公开分享，也不要粘贴到不可信的网站。
```

Use only local CSS and native browser APIs. Do not add a UI framework, external font, analytics, or remote asset.

- [ ] **Step 6: Verify page behavior locally**

Run:

```bash
npm test -- tests/generate-url.test.mjs
npm run lint
```

Then serve `public/` using an ephemeral local static server and verify in a browser:

- template/minimal toggles the automatic-selection control;
- nested query parameters round-trip correctly;
- copy reports success;
- no request is sent while generating the URL.

Expected: automated checks pass and the browser Network panel stays empty during generation.

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/styles.css public/generate-url.mjs tests/generate-url.test.mjs
git commit -m "feat(jams2surge): 添加在线订阅地址生成页"
```

---

### Task 8: Document Deployment and Verify the Whole Product

**Files:**
- Modify: `README.md`

**Interfaces:**
- Documents: Vercel import, endpoint contract, URL generator, privacy, failure behavior, and local verification.

- [ ] **Step 1: Update the README**

Add sections with exact runnable examples:

```text
## Vercel 在线服务
## 生成在线订阅地址
## 在线服务的隐私与限制
```

Include this shell-safe example with a placeholder rather than a real credential:

```bash
node -e 'const u=new URL("https://your-domain.example/api/subscription");u.searchParams.set("url","https://provider.example/sub?token=REPLACE_ME");u.searchParams.set("mode","template");u.searchParams.set("autoSelect","1");console.log(u.toString())'
```

State explicitly that the generated URL contains the upstream subscription, there is no authentication or server-side cache, failures return an HTTP error, and the URL must not be shared.

- [ ] **Step 2: Run fresh full verification**

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run build:vercel
git diff --check
```

Expected:

- all test files pass with zero failures;
- TypeScript emits no errors;
- Raycast lint and Prettier checks pass;
- Raycast extension build succeeds;
- Vercel build typecheck succeeds;
- no whitespace errors are reported.

- [ ] **Step 3: Inspect the deployable surface**

```bash
git status --short
git diff --stat HEAD~7..HEAD
```

Confirm only the documented production, test, configuration, lockfile, and README paths changed. Confirm `../prompthub/` was never staged or committed.

- [ ] **Step 4: Request an independent code review**

Ask the reviewer to check spec alignment, SSRF and DNS-rebinding protection, redirect behavior, secret leakage, response headers, Vercel compatibility, Raycast regressions, and test quality. Fix every Critical or Important issue and rerun Step 2.

- [ ] **Step 5: Commit documentation or review fixes**

```bash
git add README.md
git commit -m "docs(jams2surge): 补充 Vercel 部署说明"
```

If review fixes touch production or tests, stage those exact paths in the same final commit with a scoped `fix(jams2surge): ...` message rather than using `git add -A`.

---

## Completion Checklist

- [ ] Every new production behavior was preceded by a focused failing test.
- [ ] The generated endpoint reads changed upstream content on every request.
- [ ] Template/minimal and auto-selection options match Raycast behavior.
- [ ] Public-address checks cover IPv4, IPv6, mapped IPv4, DNS results, and redirects.
- [ ] The transport connects only to a validated DNS result.
- [ ] Response size, source size, redirect count, and total timeout are bounded.
- [ ] No error path reflects secrets or internal exceptions.
- [ ] Every response disables caching and MIME sniffing.
- [ ] The generator performs URL construction locally without third-party resources.
- [ ] Raycast and Vercel builds both pass.
- [ ] README and the deployed generator warn that the output URL exposes the upstream subscription.
