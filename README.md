# Antigravity Proxy


将 Antigravity 封装成 **OpenAI / Anthropic / Gemini** 标准格式，支持 Gemini、Claude等多种模型，完美兼容 Claude Code。

## 核心特性

- **三端兼容** — 同时支持 OpenAI、Anthropic、Gemini 三种 API 格式
- **账号池管理** — 多账号轮询，自动切号重试
- **账号导入导出** — 支持将token以 JSON 文件批量导入和导出
- **配额可视化** — 实时同步各模型配额，一目了然
- **容量退避** — 429/配额耗尽自动冷却，指数退避策略
- **流式输出** — 完整 SSE 支持，包括 thinking 流式输出
- **工具调用** — OpenAI function calling / Anthropic tool_use 完整支持
- **多模态** — 图片输入、图片生成（gemini-3-pro-image）
- **Claude Code 兼容** — thinking signature 自动缓存回放

## 支持模型

| Gemini | Claude |
|--------|--------|
| gemini-3-flash | claude-opus-4-6 |
| gemini-3-flash-thinking | claude-opus-4-6-thinking |
| gemini-3.1-pro-high/low | claude-sonnet-4-6 |
| gemini-2.5-pro/flash | claude-sonnet-4-6-thinking |
| gemini-2.5-flash-thinking | |
| gemini-2.5-flash-lite | |
| gemini-3-pro-image | |

## 快速开始

### 一键安装

**Linux / macOS：**
```bash
curl -fsSL https://raw.githubusercontent.com/Kazuki-0147/Antigravity-Proxy/main/install.sh | bash
```

**Windows (PowerShell)：**
```powershell
irm https://raw.githubusercontent.com/Kazuki-0147/Antigravity-Proxy/main/install.ps1 | iex
```

安装后编辑 `.env` 配置文件，然后运行可执行文件即可。

**Linux 后台运行（可选）：**
```bash
# 创建 systemd 服务（需要 root）
sudo tee /etc/systemd/system/antigravity.service << EOF
[Unit]
Description=Antigravity Proxy
After=network.target

[Service]
Type=simple
WorkingDirectory=$(pwd)
ExecStart=$(pwd)/antigravity-proxy-linux-x64
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now antigravity
```

### 使用 Docker 镜像

无需克隆代码，直接拉取镜像运行：

```bash
# 1. 下载配置文件
curl -O https://raw.githubusercontent.com/Kazuki-0147/Antigravity-Proxy/main/docker-compose.ghcr.yml

# 2. 编辑docker-compose.ghcr.yml，修改 API_KEY 和 ADMIN_PASSWORD
nano docker-compose.ghcr.yml  # 或使用其他编辑器

# 3. 启动
docker-compose -f docker-compose.ghcr.yml up -d
```

更新到最新版本：

```bash
docker-compose -f docker-compose.ghcr.yml pull
docker-compose -f docker-compose.ghcr.yml up -d
```

### 从源码构建

```bash
# 1. 克隆项目
git clone https://github.com/Kazuki-0147/Antigravity-Proxy.git
cd Antigravity-Proxy

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，修改 ADMIN_PASSWORD 和 API_KEY

# 3. 启动
docker compose up -d --build
```

### 本地运行

```bash
npm start  # 需要 Node.js 18+
```

启动后访问 `http://localhost:8088`，使用 `ADMIN_PASSWORD` 登录管理面板。

## 添加账号

1. 打开管理面板 → 账号管理
2. 点击 **OAuth 添加**，按提示完成 Google 授权
3. 或手动填写 `email` + `refresh_token`

## API 使用

### OpenAI 格式

```bash
curl http://localhost:8088/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-2.5-flash","messages":[{"role":"user","content":"Hello!"}]}'
```

### Anthropic 格式

```bash
curl http://localhost:8088/v1/messages \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-opus-4-5","max_tokens":1024,"messages":[{"role":"user","content":"Hello!"}]}'
```

### Gemini 格式

```bash
curl http://localhost:8088/v1beta/models/gemini-2.5-flash:generateContent \
  -H "x-goog-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"role":"user","parts":[{"text":"Hello!"}]}]}'
```

## 环境变量

### 基础配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 8088 | 服务端口 |
| `ADMIN_PASSWORD` | - | 管理面板密码 |
| `API_KEY` | - | API 访问密钥（客户端调用时需要提供） |

### 并发与重试配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DISABLE_LOCAL_LIMITS` | 1 | 禁用本地并发限制（1=禁用，0=启用） |
| `MAX_CONCURRENT_PER_MODEL` | 5 | 单模型并发上限 |
| `MAX_CONCURRENT_PER_ACCOUNT` | 1 | 单账号并发上限 |
| `UPSTREAM_CAPACITY_RETRIES` | 2 | 上游容量错误重试次数 |
| `UPSTREAM_CAPACITY_RETRY_DELAY_MS` | 1000 | 上游容量错误重试延迟（毫秒） |
| `RETRY_TOTAL_TIMEOUT_MS` | 30000 | 重试总超时时间（毫秒） |
| `SAME_ACCOUNT_RETRIES` | 2 | 同号重试次数 |
| `ERROR_COUNT_TO_DISABLE` | 3 | 连续失败多少次才禁用账号 |

### 工具调用配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TOOL_RESULT_MAX_CHARS` | 0 | tool_result 单条最大字符数（0=不限制） |
| `TOOL_RESULT_TOTAL_MAX_CHARS` | 0 | tool_result 总计最大字符数（0=不限制） |
| `MAX_OUTPUT_TOKENS_WITH_TOOLS` | 0 | 工具调用时的最大输出 tokens（0=不限制） |

### 其他配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DASHBOARD_TZ_OFFSET_MINUTES` | 480 | 仪表盘时区偏移（分钟），中国时间为 480 |
| `OUTBOUND_PROXY` | - | 出站代理（如 `http://127.0.0.1:7890`） |

完整环境变量说明见 `.env.example`。

## 项目结构

```
antigravity-proxy/
├── docker-compose.yml
├── backend/
│   ├── public/          # 前端管理面板
│   └── src/
│       ├── routes/      # API 路由 (openai/anthropic/gemini)
│       ├── services/    # 账号池/Token管理/格式转换
│       └── db/          # SQLite 数据库
└── data/                # 数据持久化目录
```


## License

MIT
