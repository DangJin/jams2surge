# Jams2Surge

Jams2Surge 可作为本机 Raycast 扩展使用，也可选择部署为 Vercel 在线服务。它下载代理订阅，将其中兼容的 `ss://` 节点转换为可复制、保存或在线订阅的 Surge profile。

## 功能

- 支持明文、Base64 和 Base64URL 订阅。
- 支持 Shadowsocks SIP002 URI 和常见旧式整段 Base64 URI。
- 支持 Surge 可用的 Shadowsocks 加密方式及 simple-obfs 的 `http` / `tls` 参数。
- 识别无效节点并继续处理同一订阅中的其他节点。
- 识别 `vless://` 并给出兼容性说明。
- 可将节点自动合并到“晚安 Surge”公共分流模板，并更新“代理”策略组。
- 在 Raycast 本地加密存储中保留最近一次成功使用的订阅地址。
- 预览、复制或保存生成的完整 Surge profile。

Surge 当前不原生支持 VLESS。扩展不会把 VLESS 伪装成 VMess 或生成无法工作的代理行，因此 VLESS 节点只会出现在“未转换项目”中。

## 环境要求

- macOS 和 [Raycast](https://www.raycast.com/)
- Node.js 22 或更高版本
- npm

## 本地安装

```bash
npm install
npm run dev
```

Raycast 打开开发扩展后，搜索并运行 `Convert Subscription to Surge`。

## 使用方式

1. 粘贴一个 `http://` 或 `https://` 订阅地址。
2. 执行“转换为 Surge Profile”。
3. 选择输出模式：
   - “结合晚安 Surge 模板”：下载公共分流模板，将节点加入 `[Proxy]` 和“代理”策略组；
   - “最小独立配置”：只生成基础 section 和 `FINAL,Proxy`。
4. 模板模式下可选择是否添加“自动选择”测速组。
5. 在结果页检查已转换、不兼容和无效项目数量。
6. 选择“复制配置”，或将 `.conf` 文件保存到 `~/Downloads`。

转换成功后，订阅地址会自动保存在 Raycast 本地；下次打开命令时自动填充。表单动作菜单中的“清除已保存地址”可以删除这条本地记录。

生成的 profile 包含以下 section：

- `[General]`
- `[Proxy]`
- `[Proxy Group]`
- `[Rule]`

最小配置的默认策略组名为 `Proxy`，默认规则为 `FINAL,Proxy`。模板模式保留上游规则，并把生成的节点接入模板的“代理”策略组；OpenAI、Claude、谷歌服务、漏网之鱼等下游策略组会继续引用它。

两种输出模式都会在 `[Rule]` 顶部加入公司产品直连规则。除 LinkModel 外，配置还内置 41 个阿里系根域名，覆盖阿里云、淘宝、天猫、1688、支付宝、钉钉、高德、饿了么、优酷、UC、AliExpress 等主要产品。

其中阿里云核心规则包括：

```ini
DOMAIN-SUFFIX,aliyun.com,DIRECT,extended-matching
DOMAIN-SUFFIX,aliyuncs.com,DIRECT,extended-matching
DOMAIN-SUFFIX,alibabacloud.com,DIRECT,extended-matching
```

`DOMAIN-SUFFIX` 会覆盖根域名及所有层级的子域名，因此 RDS、OSS 和 OpenAPI 等使用 `*.aliyuncs.com` 的服务端点都会直连。规则完全内置，不依赖远程规则集；模板已有相同 DIRECT 规则时会统一去重并规范化。

## Vercel 在线服务

将仓库导入 Vercel 后，将项目的 **Root Directory** 设置为 `jams2surge`，再直接部署即可。服务无需数据库、Redis 或环境变量；Vercel 会按 `vercel.json` 执行构建，并发布静态生成页和 `/api/subscription` Function。

在线接口只接受 `GET /api/subscription`，查询参数如下：

- `url`：必填，使用 HTTPS 的上游订阅地址；
- `mode`：可选，`template`（默认）或 `minimal`；
- `autoSelect`：可选，`1`（默认）或 `0`，仅模板模式生效。

可用下面的命令安全生成带嵌套查询参数的示例地址：

```bash
node -e 'const u=new URL("https://your-domain.example/api/subscription");u.searchParams.set("url","https://provider.example/sub?token=REPLACE_ME");u.searchParams.set("mode","template");u.searchParams.set("autoSelect","1");console.log(u.toString())'
```

接口会实时下载上游订阅并生成 Surge 配置。请求参数无效、订阅无法下载、没有兼容节点或生成结果过大时，会返回对应的 HTTP 错误状态和简短错误文本，不会返回失效配置。

## 生成在线订阅地址

部署后打开站点首页：

1. 粘贴 HTTPS 上游订阅地址；
2. 选择模板或最小输出模式；
3. 按需启用“自动选择”，然后点击“生成地址”；
4. 复制结果并添加到 Surge。

地址完全在浏览器本地生成，生成过程不会请求上游订阅或第三方服务。最小模式会自动关闭“自动选择”。

## 在线服务的隐私与限制

- 生成的 URL 包含完整上游订阅地址，可能含有访问令牌；请勿分享该 URL，也不要将其粘贴到不可信的网站。
- 服务没有身份验证，也没有服务端缓存或持久化存储；每次请求都会实时转换。
- 上游地址必须使用 HTTPS，且解析到公网地址；重定向也会逐跳检查，以阻止访问内网地址。
- 在线下载总超时不超过 15 秒，响应体上限为 4 MiB，最多跟随 3 次重定向。
- 转换失败会返回 HTTP 错误；错误文本不会包含完整订阅地址、凭据或订阅响应正文。

## 隐私与限制

- 订阅由扩展直接从本机请求，不经过 Jams2Surge 服务器。
- 扩展只在 Raycast 本地加密存储中保留最近一个成功使用的订阅地址，不保存订阅响应或节点内容。
- 模板模式会同时从 GitHub 下载固定的 [`Surge-Mac.conf`](https://raw.githubusercontent.com/iFaNGMiNGi/Surge-Config/main/Surge-Mac.conf)。
- 只有主动复制或保存时，生成结果才会写入剪贴板或磁盘。
- 下载超时为 15 秒，响应体上限为 5 MiB。
- 错误提示不会包含完整订阅地址、密码、UUID、公钥或响应正文。

## 开发验证

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run build:vercel
```

下载相关测试只使用监听在 `127.0.0.1` 随机端口的临时 HTTP 服务，不访问真实订阅。

## 协议资料

- [Surge Profile Format](https://manual.nssurge.com/profile/format.html)
- [Surge Shadowsocks](https://manual.nssurge.com/policies/shadowsocks.html)
- [Shadowsocks SIP002 URI Scheme](https://github.com/shadowsocks/shadowsocks-org/wiki/SIP002-URI-Scheme)
- [VLESS 分享链接标准提案](https://github.com/XTLS/Xray-core/discussions/716)
