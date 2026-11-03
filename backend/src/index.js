import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

import { SERVER_CONFIG } from './config.js';
import { initDatabase } from './db/index.js';
import { startTokenRefreshScheduler, startQuotaSyncScheduler, startLogCleanupScheduler, getAllActiveAccounts } from './services/tokenManager.js';
import { configureGlobalFetchDispatcher } from './runtime/fetch-dispatcher.js';
import { resolveRuntimePath } from './runtime/paths.js';
import { startUnleashScheduler } from './services/unleash.js';
import { startAllHeartbeats } from './services/warmup.js';
import { startTelemetryScheduler } from './services/telemetry.js';
import { startVersionFetcher } from './services/versionFetcher.js';

import openaiRoutes from './routes/openai.js';
import anthropicRoutes from './routes/anthropic.js';
import geminiRoutes from './routes/gemini.js';
import adminRoutes from './routes/admin.js';
import oauthRoutes from './routes/oauth.js';
import authRoutes from './routes/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 启动服务器
 * @param {Object} options - 配置选项
 * @param {string} options.dbPath - 数据库路径
 * @param {string|Object} options.nativeBinding - better-sqlite3 原生模块
 * @param {string} options.schemaSql - 内联的 schema SQL
 * @param {string} options.staticRoot - 静态资源目录
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
export async function startServer(options = {}) {
    // 配置全局 fetch dispatcher（代理、超时等）
    configureGlobalFetchDispatcher();

    const dbPath = resolveRuntimePath(options.dbPath || SERVER_CONFIG.db_path);

    // 确保数据目录存在
    const dataDir = dirname(dbPath);
    if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
    }

    // 初始化数据库
    initDatabase({
        dbPath,
        nativeBinding: options.nativeBinding,
        schemaSql: options.schemaSql
    });

    // 创建 Fastify 实例
    const fastify = Fastify({
        logger: false,
        disableRequestLogging: true,
        bodyLimit: 50 * 1024 * 1024 // 50MB，支持大文件（如图片）
    });

    // 注册 CORS
    await fastify.register(cors, {
        origin: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'anthropic-api-key', 'x-goog-api-key', 'anthropic-version'],
        credentials: true
    });

    // 注册静态文件服务（前端）
    let staticRoot = options.staticRoot || null;
    if (!staticRoot) {
        const staticPathCandidates = [
            // 新版：纯静态管理面板（无需构建）
            join(__dirname, '../public'),
            // 兼容旧版：Vue build 产物
            join(__dirname, '../../frontend/dist'),
            // 打包布局：dist/public
            join(__dirname, 'public'),
            // 打包布局：可执行文件同目录的 public
            resolveRuntimePath('public')
        ];

        for (const p of staticPathCandidates) {
            if (p && existsSync(join(p, 'index.html'))) {
                staticRoot = p;
                break;
            }
        }
    }

    if (staticRoot && existsSync(join(staticRoot, 'index.html'))) {
        await fastify.register(fastifyStatic, {
            root: staticRoot,
            prefix: '/',
            setHeaders: (res) => {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            }
        });

        // SPA history fallback：浏览器直接刷新 /accounts 等路由时返回 index.html
        fastify.setNotFoundHandler((request, reply) => {
            const accept = String(request.headers.accept || '');
            const wantsHtml = accept.includes('text/html');

            if (request.method === 'GET' && wantsHtml) {
                return reply.sendFile('index.html');
            }

            return reply.code(404).send({
                error: {
                    message: 'Not Found',
                    type: 'invalid_request_error',
                    code: 'not_found'
                }
            });
        });
    }

    // 注册路由
    await fastify.register(openaiRoutes);
    await fastify.register(anthropicRoutes);
    await fastify.register(geminiRoutes);
    await fastify.register(adminRoutes);
    await fastify.register(oauthRoutes);
    await fastify.register(authRoutes);

    // 错误处理
    fastify.setErrorHandler((error, request, reply) => {
        // OpenAI 格式的错误响应
        reply.code(error.statusCode || 500).send({
            error: {
                message: error.message || 'Internal server error',
                type: 'api_error',
                code: error.code || 'internal_error'
            }
        });
    });

    // 启动版本自动获取
    startVersionFetcher();

    // 启动定时任务
    startTokenRefreshScheduler();
    startQuotaSyncScheduler();
    startLogCleanupScheduler();

    // 启动伪装服务（Unleash 心跳、Heartbeat 保活、遥测上报）
    const getAccounts = () => getAllActiveAccounts();
    startUnleashScheduler(getAccounts);
    startTelemetryScheduler(getAccounts);
    // Heartbeat 在首次获取到账号列表后启动
    setTimeout(() => {
        try { startAllHeartbeats(getAccounts()); } catch { /* ignore */ }
    }, 15_000);

    // 启动服务器
    try {
        await fastify.listen({
            port: SERVER_CONFIG.port,
            host: SERVER_CONFIG.host
        });
        console.log(`[Server] Listening on http://${SERVER_CONFIG.host}:${SERVER_CONFIG.port}`);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }

    // 优雅关闭
    let shuttingDown = false;
    async function shutdown() {
        if (shuttingDown) return;
        shuttingDown = true;
        try {
            await fastify.close();
        } finally {
            process.exit(0);
        }
    }
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    return fastify;
}
