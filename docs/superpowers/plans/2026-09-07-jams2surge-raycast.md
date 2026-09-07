# Jams2Surge Raycast Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Raycast command that downloads a proxy subscription, converts compatible Shadowsocks URIs into a minimal Surge profile, and reports unsupported VLESS entries safely.

**Architecture:** Keep the download, subscription decoding, URI parsing, profile generation, and Raycast UI in separate focused modules. All protocol logic is pure and test-first; only the fetch module and command component perform side effects.

**Tech Stack:** Raycast API, React, TypeScript, Node.js built-ins, Vitest, ESLint/Prettier through Raycast CLI

**Spec:** `docs/superpowers/specs/2026-09-07-jams2surge-raycast-design.md`

## Global Constraints

- The extension runs locally in Raycast and has no server, account, analytics, or database.
- Only `http:` and `https:` subscription URLs are accepted.
- Requests time out after 15 seconds and response bodies are capped at 5 MiB.
- Subscription URLs, response bodies, passwords, UUIDs, and public keys must not appear in logs or user-facing errors.
- `ss://` supports SIP002, legacy whole-payload Base64, IPv4, IPv6, domains, percent encoding, duplicate names, and compatible simple-obfs parameters.
- Unsupported ciphers or plugins become node-level issues; one invalid node must not block valid siblings.
- `vless://` is identified and summarized but never emitted as a Surge proxy.
- A profile is produced only when at least one compatible Shadowsocks node exists.
- Generated profiles preserve subscription order and contain `[General]`, `[Proxy]`, `[Proxy Group]`, and `[Rule]`.
- Tests, typecheck, Raycast lint, and the production build must pass before completion.

## File Map

- `package.json`: Raycast manifest, scripts, and dependencies.
- `tsconfig.json`: strict TypeScript configuration.
- `eslint.config.js`: Raycast ESLint configuration.
- `assets/extension-icon.png`: local extension icon.
- `src/convert-subscription.tsx`: Raycast form, progress state, result detail, copy, and save actions.
- `src/subscription/types.ts`: shared node, issue, and conversion result contracts.
- `src/subscription/decode.ts`: plain/Base64 subscription decoding and URI extraction.
- `src/subscription/parse-shadowsocks.ts`: Shadowsocks URI parsing and Surge compatibility checks.
- `src/subscription/convert.ts`: protocol dispatch, VLESS safe summaries, and duplicate-name resolution.
- `src/subscription/generate-profile.ts`: deterministic Surge profile output and value escaping.
- `src/subscription/fetch.ts`: validated, bounded subscription download.
- `tests/decode.test.ts`: subscription decoding behaviors.
- `tests/parse-shadowsocks.test.ts`: SIP002 and legacy SS parsing behaviors.
- `tests/convert.test.ts`: mixed subscription, VLESS, errors, and deduplication behaviors.
- `tests/generate-profile.test.ts`: exact Surge profile output and escaping.
- `tests/fetch.test.ts`: controlled local HTTP-server download behaviors.
- `README.md`: local installation and usage, supported formats, and VLESS limitation.

---

### Task 1: Project Scaffold and Subscription Decoding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `eslint.config.js`
- Create: `assets/extension-icon.png`
- Create: `src/subscription/decode.ts`
- Test: `tests/decode.test.ts`

**Interfaces:**
- Produces: `decodeSubscription(input: string): string[]`
- Throws: `SubscriptionDecodeError` with a safe, fixed message for empty or unrecognized input.

- [ ] **Step 1: Scaffold the Raycast manifest and test runner**

Create a Raycast view command named `convert-subscription`, strict TypeScript config, Raycast ESLint config, and scripts for `dev`, `build`, `lint`, `typecheck`, and `test`. Pin current compatible releases obtained by `npm install @raycast/api @raycast/utils` and development packages `typescript vitest @types/node @types/react eslint @raycast/eslint-config prettier` so the lockfile is deterministic.

- [ ] **Step 2: Write failing decoder tests**

```ts
import { describe, expect, it } from "vitest";
import { decodeSubscription, SubscriptionDecodeError } from "../src/subscription/decode";

describe("decodeSubscription", () => {
  it("keeps recognized URIs from a plain-text subscription in order", () => {
    expect(decodeSubscription("ss://one\n\nvless://two\nunknown://three")).toEqual([
      "ss://one",
      "vless://two",
      "unknown://three",
    ]);
  });

  it("decodes standard Base64 with omitted padding", () => {
    const encoded = Buffer.from("ss://one\nvless://two", "utf8").toString("base64").replace(/=+$/, "");
    expect(decodeSubscription(encoded)).toEqual(["ss://one", "vless://two"]);
  });

  it("decodes Base64URL and strips a UTF-8 BOM", () => {
    const encoded = Buffer.from("\uFEFFss://one", "utf8").toString("base64url");
    expect(decodeSubscription(encoded)).toEqual(["ss://one"]);
  });

  it("rejects empty and unrecognized content without echoing it", () => {
    expect(() => decodeSubscription("  ")).toThrow(SubscriptionDecodeError);
    expect(() => decodeSubscription("secret-response-body")).toThrow("无法识别订阅格式");
  });
});
```

- [ ] **Step 3: Run the decoder test and verify RED**

Run: `npm test -- tests/decode.test.ts`

Expected: FAIL because `src/subscription/decode.ts` does not exist.

- [ ] **Step 4: Implement the minimal decoder**

Implement `normalizeText`, strict UTF-8 decoding with `TextDecoder("utf-8", { fatal: true })`, Base64/Base64URL padding normalization, and line extraction. Treat a response as plain text only when it contains `ss://` or `vless://`; decoded content must meet the same condition. Preserve every non-empty line after a recognized subscription format is established so unsupported lines can become issues later.

- [ ] **Step 5: Run decoder tests and verify GREEN**

Run: `npm test -- tests/decode.test.ts`

Expected: all decoder tests PASS.

- [ ] **Step 6: Commit the scaffold and decoder**

```bash
git add jams2surge/package.json jams2surge/package-lock.json jams2surge/tsconfig.json jams2surge/eslint.config.js jams2surge/assets/extension-icon.png jams2surge/src/subscription/decode.ts jams2surge/tests/decode.test.ts
git commit -m "feat(jams2surge): 初始化 Raycast 订阅解码"
```

### Task 2: Shadowsocks URI Parser

**Files:**
- Create: `src/subscription/types.ts`
- Create: `src/subscription/parse-shadowsocks.ts`
- Test: `tests/parse-shadowsocks.test.ts`

**Interfaces:**
- Produces: `SurgeShadowsocksNode { name, host, port, method, password, udpRelay, obfs?, obfsHost? }`.
- Produces: `parseShadowsocksUri(uri: string): SurgeShadowsocksNode`.
- Throws: `NodeParseError` with safe code/message fields and no original URI.

- [ ] **Step 1: Write failing SIP002 and legacy parser tests**

Use hand-derived fixtures to cover:

```ts
expect(parseShadowsocksUri("ss://YWVzLTI1Ni1nY206cEBzcw@example.com:8388#Tokyo")).toEqual({
  name: "Tokyo",
  host: "example.com",
  port: 8388,
  method: "aes-256-gcm",
  password: "p@ss",
  udpRelay: true,
});

expect(parseShadowsocksUri("ss://aes-128-gcm:p%40ss@[2001:db8::1]:443#IPv6")).toMatchObject({
  host: "2001:db8::1",
  port: 443,
  method: "aes-128-gcm",
  password: "p@ss",
});

const legacy = Buffer.from("chacha20-ietf-poly1305:test/!@#:@legacy.example:8888").toString("base64");
expect(parseShadowsocksUri(`ss://${legacy}#Legacy`)).toMatchObject({
  name: "Legacy",
  host: "legacy.example",
  port: 8888,
  password: "test/!@#:",
});
```

Add separate tests for a missing fragment fallback name, Unicode fragment, port 0/65536, missing password, unsupported cipher, simple-obfs mapping, and unsupported plugin.

- [ ] **Step 2: Run parser tests and verify RED**

Run: `npm test -- tests/parse-shadowsocks.test.ts`

Expected: FAIL because parser exports do not exist.

- [ ] **Step 3: Implement parser contracts and supported cipher set**

Define the exact Surge cipher allowlist from the spec's linked Surge manual. Parse the fragment before handling legacy Base64, distinguish SIP002 by an authority containing `@`, split decoded credentials on the first colon, parse host/port from the right so passwords and IPv6 remain intact, and decode URL components safely.

For plugin query values, accept `obfs-local` or `simple-obfs` command names with `obfs=http|tls` and optional `obfs-host`; reject every other plugin with `NodeParseError("unsupported-plugin", "Surge 不支持此 Shadowsocks 插件")`.

- [ ] **Step 4: Run parser tests and verify GREEN**

Run: `npm test -- tests/parse-shadowsocks.test.ts`

Expected: all parser tests PASS.

- [ ] **Step 5: Refactor only after GREEN and commit**

```bash
git add jams2surge/src/subscription/types.ts jams2surge/src/subscription/parse-shadowsocks.ts jams2surge/tests/parse-shadowsocks.test.ts
git commit -m "feat(jams2surge): 解析 Shadowsocks 节点"
```

### Task 3: Mixed-Protocol Conversion and Safe Reporting

**Files:**
- Create: `src/subscription/convert.ts`
- Test: `tests/convert.test.ts`

**Interfaces:**
- Consumes: `decodeSubscription`, `parseShadowsocksUri`, `SurgeShadowsocksNode`, `NodeParseError`.
- Produces: `ConversionResult { nodes: SurgeShadowsocksNode[]; issues: ConversionIssue[] }`.
- Produces: `convertSubscriptionText(input: string): ConversionResult`.
- `ConversionIssue` contains only `index`, optional safe `name`, `protocol`, `kind`, and `message`.

- [ ] **Step 1: Write failing conversion tests**

Test a mixed fixture containing two valid SS nodes with the same name, one malformed SS URI, one VLESS URI containing UUID/public key, and one unknown URI. Assert that:

```ts
expect(result.nodes.map((node) => node.name)).toEqual(["Tokyo", "Tokyo (2)"]);
expect(result.issues.map((issue) => issue.protocol)).toEqual(["ss", "vless", "unknown"]);
expect(JSON.stringify(result.issues)).not.toContain("11111111-1111-1111-1111-111111111111");
expect(JSON.stringify(result.issues)).not.toContain("sensitive-public-key");
expect(result.issues[1]).toMatchObject({
  name: "VLESS Tokyo",
  protocol: "vless",
  kind: "unsupported",
  message: "Surge 不原生支持 VLESS（ws/tls）",
});
```

Add a test that sanitizes control characters, commas, and equals signs in names and deduplicates the sanitized result.

- [ ] **Step 2: Run conversion tests and verify RED**

Run: `npm test -- tests/convert.test.ts`

Expected: FAIL because `convertSubscriptionText` does not exist.

- [ ] **Step 3: Implement protocol dispatch and safe summaries**

Dispatch by case-insensitive URI scheme. Catch only `NodeParseError` per SS item and continue. For VLESS, use `URL` only to extract decoded fragment plus allowlisted `type` and `security` values; never copy username, full query, or raw URI into results. Normalize names to printable single-line values, replace `,` and `=` with spaces, collapse whitespace, fall back to `Node N`, and add numeric suffixes deterministically.

- [ ] **Step 4: Run conversion tests and verify GREEN**

Run: `npm test -- tests/convert.test.ts`

Expected: all conversion tests PASS.

- [ ] **Step 5: Commit conversion behavior**

```bash
git add jams2surge/src/subscription/convert.ts jams2surge/tests/convert.test.ts
git commit -m "feat(jams2surge): 汇总订阅转换结果"
```

### Task 4: Surge Profile Generator

**Files:**
- Create: `src/subscription/generate-profile.ts`
- Test: `tests/generate-profile.test.ts`

**Interfaces:**
- Consumes: `SurgeShadowsocksNode[]`.
- Produces: `generateSurgeProfile(nodes: SurgeShadowsocksNode[]): string`.
- Throws: `ProfileGenerationError("没有可转换的 Shadowsocks 节点")` for an empty array.

- [ ] **Step 1: Write failing exact-output tests**

Use literal expected INI text for two nodes and assert the precise section order, proxy order, group members, `DIRECT`, final rule, and trailing newline:

```ini
[General]
loglevel = notify

[Proxy]
Tokyo = ss, example.com, 8388, encrypt-method=aes-256-gcm, password=secret, udp-relay=true
Osaka = ss, 2001:db8::1, 443, encrypt-method=chacha20-ietf-poly1305, password="p,a\\\"ss", udp-relay=true, obfs=tls, obfs-host=cdn.example.com

[Proxy Group]
Proxy = select, Tokyo, Osaka, DIRECT

[Rule]
FINAL,Proxy
```

Add tests for an empty node list and a password containing commas, quotes, backslashes, leading/trailing whitespace, and line breaks. Line breaks must be removed before quoting so one node cannot inject profile lines.

- [ ] **Step 2: Run generator tests and verify RED**

Run: `npm test -- tests/generate-profile.test.ts`

Expected: FAIL because the generator does not exist.

- [ ] **Step 3: Implement deterministic INI generation**

Implement one private value formatter that removes CR/LF, escapes `\` and `"`, and wraps values containing comma, quote, backslash, or edge whitespace in double quotes. Emit IPv6 hosts without URI brackets because Surge receives host and port as separate arguments. Include obfs parameters only when present.

- [ ] **Step 4: Run generator tests and verify GREEN**

Run: `npm test -- tests/generate-profile.test.ts`

Expected: all generator tests PASS.

- [ ] **Step 5: Commit the profile generator**

```bash
git add jams2surge/src/subscription/generate-profile.ts jams2surge/tests/generate-profile.test.ts
git commit -m "feat(jams2surge): 生成 Surge 配置文件"
```

### Task 5: Bounded Subscription Download

**Files:**
- Create: `src/subscription/fetch.ts`
- Test: `tests/fetch.test.ts`

**Interfaces:**
- Produces: `fetchSubscription(url: string, options?: { timeoutMs?: number; maxBytes?: number }): Promise<string>`.
- Throws: `SubscriptionFetchError` with fixed safe messages and never includes the URL or response body.

- [ ] **Step 1: Write failing local-server integration tests**

Use Node's real `http.createServer` on `127.0.0.1` with ephemeral ports. Cover a successful UTF-8 response, invalid schemes before any request, HTTP 500, declared `Content-Length` above the cap, chunked data crossing a small test cap, invalid UTF-8, and a delayed response with a 20 ms test timeout. Assert fixed messages such as `订阅请求超时`, `订阅响应过大`, and `订阅服务返回 HTTP 500` and assert they exclude the request URL.

- [ ] **Step 2: Run fetch tests and verify RED**

Run: `npm test -- tests/fetch.test.ts`

Expected: FAIL because `fetchSubscription` does not exist.

- [ ] **Step 3: Implement the bounded fetch**

Validate with `new URL`, create an `AbortController`, pass its signal to `fetch`, clear the timer in `finally`, check `response.ok` and `Content-Length`, stream with `response.body.getReader()`, abort when accumulated bytes exceed `maxBytes`, and decode with a fatal UTF-8 `TextDecoder`. Defaults are exactly 15,000 ms and `5 * 1024 * 1024` bytes.

- [ ] **Step 4: Run fetch tests and verify GREEN**

Run: `npm test -- tests/fetch.test.ts`

Expected: all fetch tests PASS with every local server closed in `afterEach`/`afterAll` cleanup.

- [ ] **Step 5: Commit the downloader**

```bash
git add jams2surge/src/subscription/fetch.ts jams2surge/tests/fetch.test.ts
git commit -m "feat(jams2surge): 安全下载代理订阅"
```

### Task 6: Raycast Command and Local Save Actions

**Files:**
- Create: `src/convert-subscription.tsx`
- Modify: `package.json`
- Test: existing pure and integration test suites

**Interfaces:**
- Consumes: `fetchSubscription`, `convertSubscriptionText`, `generateSurgeProfile`.
- Produces: default Raycast view command.

- [ ] **Step 1: Establish the command behavior to protect**

The command must submit a required URL, show an animated toast during work, push a `Detail` result only after conversion finishes, and keep failures on the form with a failure toast. The result metadata shows converted/unsupported/error counts. The markdown contains the profile in a fenced `ini` block plus safe issue summaries.

Because Raycast UI rendering is framework-owned and the business behavior is already covered through real module tests, do not add brittle component mocks. Typecheck and `ray build` are the integration contract for this thin UI layer.

- [ ] **Step 2: Implement the form and result detail**

Use `Form.TextField` with `FormValidation.Required` and URL validation. On submit, await the three domain operations. If no nodes are compatible, show `Toast.Style.Failure` with counts and a safe issue summary instead of navigating to an empty profile.

- [ ] **Step 3: Implement explicit output actions**

Add `Action.CopyToClipboard` for the full profile. Add an `Action` titled `保存到下载目录` that writes UTF-8 using `fs.promises.writeFile(path.join(os.homedir(), "Downloads", filename), profile, { flag: "wx" })`; if the timestamped name collides, add `-2`, `-3`, and so on. Show the final path only after a successful save. Do not write anything on conversion alone.

- [ ] **Step 4: Run all automated checks**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: every command exits 0 with no test failures or TypeScript/ESLint errors.

- [ ] **Step 5: Commit the Raycast workflow**

```bash
git add jams2surge/src/convert-subscription.tsx jams2surge/package.json jams2surge/package-lock.json
git commit -m "feat(jams2surge): 添加 Raycast 转换命令"
```

### Task 7: Documentation and Final Verification

**Files:**
- Create: `README.md`
- Modify only if verification finds a real defect: implementation or test files from Tasks 1–6

**Interfaces:**
- Documents the local install, development, command flow, supported URI variants, output location, and VLESS limitation.

- [ ] **Step 1: Write user documentation**

Document prerequisites (macOS, Raycast, supported Node version), `npm install`, `npm run dev`, command name, copy/save actions, the fact that subscription data stays local, and the exact compatibility boundary: compatible SS nodes convert; VLESS is reported but cannot become a native Surge proxy.

- [ ] **Step 2: Run final verification from a clean command invocation**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
git status --short --branch
```

Expected: tests report zero failures; typecheck, lint, build, and diff check exit 0. Git status may show only the intended README/plan changes plus the pre-existing unrelated `prompthub/` sibling.

- [ ] **Step 3: Manually inspect the built command in Raycast**

Run `npm run dev` in a visible Herdr command pane, open `Convert Subscription to Surge`, and verify one controlled local fixture through the form. Confirm result counts, profile preview, clipboard action, and save action. Delete only the generated test `.conf` file after recording the result; do not touch other Downloads files.

- [ ] **Step 4: Commit documentation and any verified fixes**

```bash
git add jams2surge/README.md jams2surge/docs/superpowers/plans/2026-09-07-jams2surge-raycast.md
git commit -m "docs(jams2surge): 补充安装与使用说明"
```

- [ ] **Step 5: Report completion evidence**

Report the exact test count, typecheck/lint/build exit results, manual verification status, commits created, and remaining unrelated workspace changes. Do not claim manual Raycast verification if the app could not be opened; state that limitation explicitly.
