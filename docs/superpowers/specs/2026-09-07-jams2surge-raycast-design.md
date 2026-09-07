# Jams2Surge Raycast 扩展设计

## 目标

构建一个仅在本机运行的 Raycast 扩展。用户粘贴代理订阅地址后，扩展下载并解析订阅，将其中可兼容的 Shadowsocks 节点转换为最小可用的 Surge profile，并允许用户复制或保存结果。

首个版本只处理 `ss://` 和 `vless://`：

- `ss://`：解析、校验并转换为 Surge `[Proxy]` 配置。
- `vless://`：解析基本信息并报告不兼容，不写入配置。Surge 官方当前未提供原生 VLESS policy，不能将 VLESS 无损转换成其他协议。

## 非目标

- 不运行或捆绑 Xray、sing-box 等外部核心。
- 不把 VLESS 伪装或近似转换成 VMess。
- 不提供云端服务、账号系统、订阅托管或定时更新。
- 不支持 Clash YAML、Surge profile 订阅、VMess、Trojan 等其他输入格式。
- 不测试节点延迟或连通性。

## 用户流程

扩展提供一个 `Convert Subscription to Surge` 命令：

1. 用户打开命令，看到一个订阅地址输入框。
2. 用户提交后，界面显示下载和转换进度。
3. 转换完成后进入结果页，显示：
   - 成功转换的 Shadowsocks 节点数量；
   - 不兼容的 VLESS 节点数量及节点名称；
   - 无法解析或不受支持的条目及原因；
   - 生成的 Surge profile 预览。
4. 用户可执行“复制配置”或“保存到下载目录”。保存文件名使用 `surge-profile-YYYYMMDD-HHmmss.conf`。

订阅地址和下载内容不持久化。只有用户主动复制或保存时，生成结果才离开命令内存。

## 架构

项目采用标准 Raycast Extension 结构、React、TypeScript 和 Node.js API，分为四个边界明确的模块：

1. `fetch-subscription`：只负责网络请求、超时、HTTP 状态和响应体大小限制，返回文本。
2. `decode-subscription`：判断响应是明文节点列表还是 Base64/Base64URL 订阅，并返回候选 URI。
3. `parse-nodes`：逐项识别协议，解析 Shadowsocks URI，收集 VLESS 摘要及结构化错误。
4. `generate-surge-profile`：只接收已校验节点，生成确定性的 Surge profile 文本。

Raycast 命令层只负责表单、加载状态、结果展示和用户动作，不包含协议解析规则。这样网络、协议和 UI 可独立测试与修改。

## 下载规则

- 仅接受 `http:` 和 `https:` URL。
- 使用 Node.js `fetch` 请求，不经过任何中转服务器。
- 请求超时为 15 秒。
- 最大响应体为 5 MiB；若 `Content-Length` 已超过限制则立即终止，否则在读取流时累计检查。
- 非 2xx 响应作为失败，并显示 HTTP 状态。
- 解码和解析错误不得输出完整订阅内容，避免把凭据写入日志或错误提示。

## 订阅解码规则

订阅响应按以下顺序处理：

1. 去除 UTF-8 BOM 和首尾空白。
2. 若文本本身包含 `ss://` 或 `vless://`，按明文处理。
3. 否则尝试标准 Base64，再尝试 Base64URL；允许缺失尾部 padding 和换行。
4. Base64 解码结果必须是有效 UTF-8，且至少包含一个受识别 URI，否则报告“无法识别订阅格式”。
5. 按行提取 URI，忽略空行。无法识别的非空行记录为警告，不阻断其他节点。

## Shadowsocks 解析与映射

解析器支持 Shadowsocks 官方 SIP002 URI 及常见旧式整段 Base64 URI：

- SIP002：`ss://userinfo@host:port/?plugin=...#name`
- 旧式：`ss://BASE64(method:password@host:port)#name`
- `userinfo` 可为 Base64URL 编码的 `method:password`，也可为百分号编码的明文。
- 支持域名、IPv4 和带方括号的 IPv6。
- 节点名取 URI fragment 解码值；缺失时使用 `SS host:port`。

每个合法节点生成：

```ini
节点名 = ss, host, port, encrypt-method=method, password=password, udp-relay=true
```

转换时执行以下校验和规范化：

- 端口必须是 1–65535 的整数。
- method 和 password 不得为空。
- method 必须出现在 Surge 官方 Shadowsocks 支持列表中；其他 method 作为不兼容项报告。
- 名称去除换行及 Surge 分隔符，并保证唯一；重名依次添加 ` (2)`、` (3)`。
- 包含逗号、引号或反斜杠的参数值按 Surge 配置语法转义并加双引号。
- SIP003 plugin 只映射 Surge 原生支持的 simple-obfs 语义：`obfs=http|tls` 和可选 `obfs-host`。其他插件不能保证等价，节点作为不兼容项报告。

## VLESS 处理

VLESS URI 按官方分享链接的 URL 结构识别。首版只读取 fragment、主机、端口和 transport/security 参数用于结果说明，不尝试生成 Surge policy。

每个 VLESS 条目报告为：`<节点名>：Surge 不原生支持 VLESS（<transport>/<security>）`。URI 含有的 UUID、公钥等凭据不展示在结果摘要或错误日志中。

## 生成的 Surge profile

首版生成一个自包含的最小 profile：

```ini
[General]
loglevel = notify

[Proxy]
节点 A = ss, example.com, 8388, encrypt-method=chacha20-ietf-poly1305, password=secret, udp-relay=true

[Proxy Group]
Proxy = select, 节点 A, DIRECT

[Rule]
FINAL,Proxy
```

节点顺序与订阅顺序一致。若没有可转换节点，则不生成 profile，结果页只展示错误与不兼容项，避免输出一个看似成功但实际没有代理节点的配置。

## 错误模型

错误分为三层：

- 请求级错误：URL、网络、超时、响应状态或大小错误；整个转换终止。
- 订阅级错误：响应无法识别为明文或 Base64 节点列表；整个转换终止。
- 节点级问题：单个 URI 无效、method/plugin 不兼容或 VLESS 不受支持；保留问题摘要并继续转换其他节点。

用户界面提供可操作的短错误信息，不显示堆栈、完整 URI、密码、UUID 或订阅响应。

## 测试策略

解析和生成模块使用测试驱动开发，测试固定输入和精确输出。至少覆盖：

- 明文、标准 Base64、Base64URL 和缺失 padding 的订阅；
- SIP002 Base64URL userinfo、明文 userinfo 和旧式整段 Base64；
- 百分号编码密码、Unicode 节点名、IPv6、重名节点；
- simple-obfs 映射、未知 plugin、Surge 不支持的 method；
- VLESS 识别及敏感字段不出现在摘要中；
- 混合有效与无效节点时继续转换；
- 空订阅、无可转换节点及确定性的完整 profile 快照；
- 下载超时、非 2xx、超大 `Content-Length` 和流式超限。

完成前运行单元测试、TypeScript 类型检查、Raycast lint 和 production build。网络请求测试使用本地可控响应，不访问真实订阅服务。

## 资料依据

- [Raycast API](https://developers.raycast.com/)：扩展使用 React、TypeScript 与 Node.js。
- [Raycast Form](https://developers.raycast.com/api-reference/user-interface/form)：表单输入和提交交互。
- [Surge Profile Format](https://manual.nssurge.com/profile/format.html)：profile section 与基本语法。
- [Surge Shadowsocks](https://manual.nssurge.com/policies/shadowsocks.html)：Shadowsocks policy 语法、method 和 obfs 参数。
- [Surge Policy Overview](https://manual.nssurge.com/policies/overview.html)：Surge 原生支持的 policy 类型；当前未列出 VLESS。
- [Shadowsocks SIP002](https://github.com/shadowsocks/shadowsocks-org/wiki/SIP002-URI-Scheme)：Shadowsocks URI 结构。
- [Xray VLESS 分享链接标准提案](https://github.com/XTLS/Xray-core/discussions/716)：VLESS URL 字段约定。
