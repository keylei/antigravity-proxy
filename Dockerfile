#
# Antigravity Proxy - Docker 镜像构建文件
#
# 单容器构建:
# - 构建 Node 后端依赖（包括 better-sqlite3 原生插件）
# - 运行时仅运行后端，通过 @fastify/static 提供静态文件服务
#

# ============ 构建阶段 ============
FROM node:20-alpine AS backend-builder

WORKDIR /app/backend

# 安装 better-sqlite3 编译依赖
RUN apk add --no-cache python3 make g++

# 复制依赖文件并安装
COPY backend/package*.json ./
RUN npm install --omit=dev

# 复制后端源码
COPY backend/ ./

# ============ 运行阶段 ============
FROM node:20-alpine AS runtime

# 镜像元信息
LABEL org.opencontainers.image.title="Antigravity Proxy"
LABEL org.opencontainers.image.description="AI API 代理服务，支持 Claude/Gemini 等多种模型"
LABEL org.opencontainers.image.source="https://github.com/Kazuki-0147/Antigravity-Proxy"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

# 创建数据目录
RUN mkdir -p /app/data

# 复制后端代码和依赖
COPY --from=backend-builder /app/backend /app/backend

# 暴露端口（容器内部端口，通过 docker-compose 映射到宿主机 8088）
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget -q --spider http://127.0.0.1:3000/health || exit 1

WORKDIR /app/backend
CMD ["node", "src/bootstrap.js"]
