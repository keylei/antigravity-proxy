# Antigravity Proxy

本地代理服务。它用 Google 账号池调用 Antigravity 上游，对外提供 **OpenAI / Anthropic / Gemini** 三种标准接口，可直接给 Claude Code、Cursor 或其他 SDK 当后端。

## 1. 启动

需要 Node.js 18 以上（当前在 Node 24 上运行）。

```powershell
cd <项目目录>
copy .env.example .env   # 第一次使用时复制，再按下一节修改
npm start                # 首次启动会自动安装依赖
```

看到 `[Server] Listening on http://127.0.0.1:<PORT>` 后，用浏览器打开这个地址进入管理面板。

## 2. 配置 `.env`

最少要配这几项：

| 变量 | 说明 |
|------|------|
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | **必填**。缺少时服务拒绝启动，否则所有账号的 token 都会刷新失败 |
| `API_KEY` | 客户端调用 `/v1/...` 接口时用的密钥，自己随便设一个 |
| `PORT` | 监听端口，默认 `8088` |
| `HOST` | 监听地址，默认 `127.0.0.1`。**不要改成 `0.0.0.0`**，见下方安全说明 |
| `DB_PATH` | SQLite 数据库路径，默认 `./data/database.sqlite` |

网络相关（按需配置）：

| 变量 | 说明 |
|------|------|
| `OUTBOUND_PROXY` | 出站代理，如 `http://127.0.0.1:7890`。不配置时走直连 |
| `DIRECT_IP_FAILOVER` | 直连时默认开启（`1`）。会自动挑选能完成 TLS 握手的 Google IP，用来应对 TUN 模式 VPN 下部分 IP 握手失败的情况。设为 `0` 关闭 |

并发、重试、工具输出截断等其他参数见 `.env.example`，一般保持默认即可。

> **安全说明**：管理面板和 `/admin/*` 接口目前**没有登录校验**，任何能访问端口的人都能查看和导出账号的 refresh_token。请保持 `HOST=127.0.0.1`，只在本机使用。

## 3. 添加账号

在管理面板的「账号管理」页添加：

- **OAuth 添加**：点「1. 打开授权页面」，登录 Google 后浏览器会跳到一个 `localhost` 地址（页面打不开也没关系），把地址栏的完整 URL 粘回来，点「交换并创建账号」。
- **导入**：手动填写 `refresh_token`，或拖入 JSON 文件，格式为 `[{"refresh_token":"...","email":"可选"}]`。
- **导出**：工具栏的导出按钮，或每行的 📤，导出的 JSON 可以再导入。

## 4. 管理账号

账号页常用功能：

| 功能 | 说明 |
|------|------|
| 额度条 | 每个号显示 Claude 和 Gemini 的 5 小时、每周剩余额度及重置时间 |
| 排序 | 按 Claude 或 Gemini 剩余额度排序，异常和禁用的号排在最后 |
| ↻ / 刷新全部 | 刷新 token、project_id 和额度 |
| 🩺 健康检测 | 一键检测所有号，详见下文 |
| 📍 指定账号 | 让所有请求固定使用某个号。「仅用」模式下该号不可用就直接报错；「优先」模式下额度用完会自动换成额度最多的号 |
| 批量操作 | 勾选后可以批量刷新、禁用、启用、导出、删除 |

### 健康检测

点工具栏的「🩺 健康检测」，再点「开始检测」。每个号依次执行四步：刷新 token、补齐 project_id、同步额度，最后发一条 `gemini-3-flash` 测试请求。最后一步可以在弹窗里取消勾选。

结果分三组：

- **连接不上**：refresh_token 失效（`invalid_grant`）、需要网页验证账号（`403 VALIDATION_REQUIRED`）、拿不到 project_id 等情况。
- **有警告**：网络错误或测试模型被限流，账号本身不一定有问题，可以稍后重试。
- **正常**：顺带显示 Claude 或 Gemini 额度是否已用完。

「连接不上」的号可以复制邮箱、导出 CSV，或「在列表中选中」后批量禁用或删除。检测在后台进行，关闭弹窗不会中断；最近一次结果会保存，重启服务后仍可查看。检测本身不会改动账号的启用状态。

## 5. 客户端接入

下面示例中，`<PORT>` 是 `.env` 里的端口，`<API_KEY>` 是 `.env` 里的 `API_KEY`。

### Claude Code

```powershell
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:<PORT>"
$env:ANTHROPIC_AUTH_TOKEN = "<API_KEY>"
$env:ANTHROPIC_MODEL = "claude-opus-5-5-medium"
claude
```

### OpenAI 兼容客户端（Cursor、各类 SDK）

- Base URL：`http://127.0.0.1:<PORT>/v1`
- API Key：`<API_KEY>`

```bash
curl http://127.0.0.1:<PORT>/v1/chat/completions \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-3-flash","messages":[{"role":"user","content":"Hello"}]}'
```

### 其他接口

| 格式 | 地址 | 认证头 |
|------|------|--------|
| OpenAI | `POST /v1/chat/completions`、`GET /v1/models` | `Authorization: Bearer <API_KEY>` |
| Anthropic | `POST /v1/messages` | `x-api-key: <API_KEY>` 或 Bearer |
| Gemini | `POST /v1beta/models/<模型>:generateContent` | `x-goog-api-key: <API_KEY>` |
| 健康检查 | `GET /health` | 无 |

## 6. 模型

完整列表以 `GET /v1/models` 返回为准。常用模型：

| 系列 | 模型 ID |
|------|---------|
| Claude 5.5 | `claude-opus-5-5-{high,medium,low}`、`claude-sonnet-5-5-{high,medium,low}`。后缀表示推理强度；末尾再加 `-no-thinking` 表示不输出思维链 |
| Claude 4.6 | `claude-opus-4-6(-thinking)`、`claude-sonnet-4-6(-thinking)` |
| Gemini | `gemini-3.8-flash-{high,medium,low}`、`gemini-3-flash`、`gemini-3.1-pro-{high,low}`、`gemini-2.5-pro`、`gemini-2.5-flash(-lite)` |
| 图像 | `gemini-3.1-flash-image` |

Claude 和 GPT 模型共用一组额度，Gemini 模型共用另一组额度，各自分为 5 小时和每周两个周期。

## 7. 常见问题

| 现象 | 原因与处理 |
|------|-----------|
| `Token refresh failed: 400 invalid_grant` | refresh_token 已失效，常见原因是改了密码、撤销了授权或账号被封。重新 OAuth 添加，或删除该号 |
| `403 Verify your account to continue` | Google 要求先在网页上验证账号。用浏览器登录该账号完成验证，再刷新 |
| `429 Individual quota reached` | 该号这个模型系列的额度已用完，到错误里提示的时间才会恢复。代理会自动换号 |
| `TLS handshake failed` / `fetch failed` | 网络问题。确认 `DIRECT_IP_FAILOVER` 没有关闭，或配置 `OUTBOUND_PROXY` |
| 启动报缺少 `GOOGLE_OAUTH_CLIENT_ID` | `.env` 没有填写 OAuth 凭据 |

## 8. 目录结构

```
├── .env                 # 本地配置（不提交）
├── scripts/start.mjs    # npm start 入口：读取 .env、安装依赖、启动后端
├── data/                # 默认数据库目录
└── backend/
    ├── public/          # 管理面板前端（原生 JS，无需构建）
    └── src/
        ├── routes/      # openai / anthropic / gemini / admin / oauth 路由
        ├── services/    # 账号池、token 管理、格式转换、健康检测
        ├── runtime/     # TLS 指纹请求、直连隧道
        └── db/          # SQLite 结构与读写
```

## License

MIT
