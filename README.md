# Jams2Surge

Jams2Surge 是一个仅在本机运行的 Raycast 扩展。它下载代理订阅，将其中兼容的 `ss://` 节点转换为可复制或保存的 Surge profile。

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

两种输出模式都会在 `[Rule]` 顶部加入 LinkModel 公司产品直连规则：

```ini
DOMAIN-SUFFIX,linkmodel.ai,DIRECT,extended-matching
```

它覆盖 `linkmodel.ai` 主域名及所有层级的子域名。模板已有相同 DIRECT 规则时只会规范化该行，不会重复添加。

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
```

下载相关测试只使用监听在 `127.0.0.1` 随机端口的临时 HTTP 服务，不访问真实订阅。

## 协议资料

- [Surge Profile Format](https://manual.nssurge.com/profile/format.html)
- [Surge Shadowsocks](https://manual.nssurge.com/policies/shadowsocks.html)
- [Shadowsocks SIP002 URI Scheme](https://github.com/shadowsocks/shadowsocks-org/wiki/SIP002-URI-Scheme)
- [VLESS 分享链接标准提案](https://github.com/XTLS/Xray-core/discussions/716)
