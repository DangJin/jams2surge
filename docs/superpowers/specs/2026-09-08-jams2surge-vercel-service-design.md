# Jams2Surge Vercel 在线订阅转换服务设计

## 背景

现有 Raycast 插件会在用户手动执行时下载一次上游订阅并生成静态 Surge profile。上游节点变化后，已经保存到 Surge 的配置不会自动更新。

本次增加一个部署在 Vercel 的无状态在线转换服务。Surge 使用固定格式的 URL 订阅该服务；每次刷新时，服务实时下载上游订阅并生成最新 profile。

## 目标

- 提供一个可直接添加到 Surge 的在线订阅 URL。
- 每次请求都实时读取上游，不持久化订阅地址、节点或生成结果。
- 复用现有订阅解析、节点转换、模板合并和公司直连规则。
- 保留 Raycast 插件及其现有行为。
- 支持“晚安 Surge 模板”和“最小独立配置”两种输出模式。
- 模板模式继续支持“自动选择”测速组开关。
- 提供一个纯前端页面，帮助用户安全地完成 URL 编码和参数拼接。
- 在无数据库、无账号系统的前提下，防止服务被用于访问内网或云平台元数据地址。

## 非目标

- 不提供管理员后台、登录、用户注册或多租户。
- 不保存配置，不生成可撤销的短链接。
- 不提供服务端缓存或最近成功配置兜底。
- 不隐藏上游订阅地址；URL 编码不是加密。
- 不增加订阅转换历史、用量统计、限流控制台或审计日志。
- 不改变当前仅转换 Shadowsocks、仅报告 VLESS 的协议范围。

## 总体架构

项目保留现有 Raycast 入口，并新增两个 Vercel 入口：

```text
src/subscription/       纯转换核心，由 Raycast 和 Vercel Function 复用
src/convert-subscription.tsx
                        现有 Raycast 插件入口
api/subscription.ts     Vercel 无状态订阅接口
public/index.html       纯前端 URL 生成页
```

不引入 Next.js、Redis、Blob、数据库或服务端 Session。Vercel 使用 Node.js Function 运行 `api/subscription.ts`，静态托管 `public/index.html`。

## HTTP 接口

### 请求

```http
GET /api/subscription?url=<encoded-url>&mode=template&autoSelect=1
```

查询参数：

| 参数 | 必填 | 允许值 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `url` | 是 | URL 编码后的 HTTPS URL | 无 | 上游代理订阅地址 |
| `mode` | 否 | `template`、`minimal` | `template` | 输出模式 |
| `autoSelect` | 否 | `1`、`0` | `1` | 是否生成自动测速组，仅模板模式生效 |

未知参数被忽略；已提供但值非法的 `mode` 或 `autoSelect` 返回 HTTP 400。接口只接受 `GET`，其他方法返回 HTTP 405 并带 `Allow: GET`。

### 成功响应

- 状态码：HTTP 200。
- `Content-Type: text/plain; charset=utf-8`。
- `Cache-Control: private, no-store`。
- `X-Content-Type-Options: nosniff`。
- Body：完整 Surge profile，结尾保留换行。

响应不使用 Vercel CDN 缓存，保证每次请求都重新读取上游。

### 错误响应

| 状态码 | 场景 |
| --- | --- |
| 400 | 缺少参数、参数格式错误或上游 URL 不符合约束 |
| 405 | 请求方法不是 GET |
| 422 | 上游内容可读取，但没有可转换的 Shadowsocks 节点 |
| 502 | 上游、模板下载失败，或上游响应无效 |
| 504 | 上游或模板请求超时 |

错误响应使用简短纯文本，不回显完整上游 URL、订阅正文、节点密码或异常堆栈，并同样设置 `Cache-Control: private, no-store`。

## 请求处理流程

```text
解析并校验查询参数
  → 安全下载上游订阅
  → 解析并转换节点
  → mode=template 时下载固定模板
  → 调用现有 profile 生成或模板合并函数
  → 返回 text/plain Surge profile
```

模板和上游可以并行下载，但只有上游必需。`minimal` 模式不会请求模板 URL。

上游或模板失败时直接返回错误，不保存也不返回旧配置。Surge 客户端如何保留上一次成功配置不属于本服务的状态管理范围。

## 转换核心复用

现有模块保持框架无关：

- `decode.ts`：识别明文、Base64 和 Base64URL 订阅。
- `parse-shadowsocks.ts`：解析 Shadowsocks URI。
- `convert.ts`：生成节点和转换问题列表。
- `generate-profile.ts`：生成最小配置。
- `merge-profile.ts`：合并晚安 Surge 模板。
- `company-rules.ts`：生成 LinkModel 与阿里系直连规则。

Vercel Function 只负责 HTTP 参数、出站下载、状态码和响应头，不复制转换逻辑。Raycast 入口继续使用原有本地下载及保存流程。

## 安全设计

### 上游 URL 暴露

上游订阅地址作为查询参数存在于最终 URL 中。URL 编码只解决嵌套查询参数的语法问题，不提供保密性。生成页必须明确提示用户：不要公开分享生成后的 URL，也不要将其粘贴到不可信网站。

应用代码不得主动记录完整请求 URL、上游 URL、订阅正文或生成 profile。

### SSRF 防护

由于接口接收调用方提供的 URL，以下限制为必需项：

1. 只允许 `https:`，拒绝 URL 中的用户名、密码以及默认 443 以外的端口。
2. 拒绝 `localhost`、`.localhost` 及 IP 字面量中的环回、私网、链路本地、组播、保留和未指定地址。
3. DNS 解析后拒绝所有非公网 IPv4/IPv6 结果。
4. 实际 HTTPS 连接使用已校验的 DNS 结果，避免在校验与连接之间再次解析而产生 DNS rebinding。
5. 最多跟随 3 次重定向；每一跳都重新执行协议、主机和 DNS/IP 校验。
6. 不向上游转发客户端的 Cookie、Authorization、Referer 或其他敏感请求头。

固定的晚安 Surge 模板 URL 不接收用户输入，但仍使用相同的超时和响应体限制。

### 资源限制

- 单个上游请求超时 15 秒。
- 重定向最多 3 次。
- 上游或模板响应体最大 4 MiB，以低于 Vercel Function 的 4.5 MiB 请求/响应限制。
- 生成 profile 超过 4 MiB 时返回 HTTP 502，不尝试返回截断内容。
- 读取流时累计字节数，不能只信任 `Content-Length`。

本期不实现应用级限流。公开部署仍可能产生带宽与 Function 调用费用，这是无账号、无密钥方案的已知风险；需要控制公开访问时，应在后续版本增加共享访问密钥或 Vercel Firewall 规则。

## URL 生成页

`public/index.html` 是无框架静态页面，包含：

- 上游 HTTPS 订阅地址输入框。
- 输出模式选择。
- 自动选择测速组开关；最小模式下禁用并忽略。
- 生成按钮。
- 只读结果框和复制按钮。
- 关于 URL 会暴露原始订阅地址的明确提示。

页面使用浏览器原生 `URL` 和 `URLSearchParams` 生成地址。生成动作完全在浏览器本地完成，不调用服务端；只有用户或 Surge 实际访问生成 URL 时，上游地址才会发送到 Vercel Function。

页面不加载第三方脚本、字体、统计或远程资源。

## 部署配置

部署不需要数据库或应用密钥。Vercel 项目只需：

- 使用仓库根目录作为项目根目录。
- 构建并发布 `public/` 静态文件与 `api/` Function。
- 为 Function 选择 Node.js runtime。
- 将 Function 部署在能够稳定访问上游订阅和 GitHub 模板的区域。

README 提供 Vercel 导入、部署和生成 URL 的操作说明，并说明 URL 保密、实时请求以及不提供故障缓存的行为。

## 测试策略

### 单元测试

- 查询参数默认值与非法值。
- HTTP 方法限制。
- 上游 URL 协议、主机和凭据校验。
- IPv4/IPv6 私网与保留地址拒绝。
- 重定向逐跳校验和次数上限。
- 超时、HTTP 错误、无效 UTF-8 和响应体上限。
- `minimal` 与 `template` 输出选择。
- `autoSelect` 开关传递。
- 无兼容节点时返回 422。
- 错误信息不泄露订阅地址或正文。
- 成功和失败响应的内容类型、安全头与缓存头。

### 集成测试

- 使用本地 HTTPS/HTTP 测试服务或可注入的安全下载器验证 Function 数据流，不请求真实订阅。
- 验证同一个在线地址在上游内容改变后返回新 profile，证明服务没有持久化旧结果。
- 运行现有 Raycast 转换测试，确保在线服务没有改变插件行为。

### 确定性验证

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

另增加针对 Vercel Function 和静态生成页的构建检查。

## 验收标准

1. 用户能够在静态页面输入上游 HTTPS 地址并生成格式正确的在线订阅 URL。
2. Surge 或 `curl` 请求生成 URL 时获得 HTTP 200 和有效 Surge profile。
3. 修改上游订阅内容后，再次请求同一 URL 能看到更新后的节点。
4. 两种输出模式与自动测速组选项行为和 Raycast 插件一致。
5. LinkModel 和阿里系直连规则继续存在于生成配置顶部。
6. 私网、环回、链路本地、保留地址和危险重定向均被拒绝。
7. 接口不保存订阅地址、节点或 profile，不使用数据库或远程缓存。
8. Raycast 插件继续构建并保持原有功能。

## 已知取舍

- 生成 URL 本身包含敏感的上游订阅地址。
- 无法单独撤销某个已生成地址；只能修改或停用上游订阅。
- 上游或模板失败时没有服务端兜底配置。
- 无应用级鉴权和限流，知道服务域名的人可以调用转换接口。
- 在线服务可用性依赖 Vercel、上游订阅和模板源。
