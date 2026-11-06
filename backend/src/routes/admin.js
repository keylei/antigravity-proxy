import { verifyAdmin } from '../middleware/auth.js';
import {
    getAllAccounts, getAccountById, createAccount, updateAccountStatus, deleteAccount,
    getAllAccountsForRefresh,
    getAccountQuotaBuckets, getAllQuotaBuckets,
    getRequestLogs, getRequestLogsTotal, getRequestStats, getRequestAttemptStats, getModelUsageStats, getModelAttemptUsageStats,
    getRequestAttemptLogs, getRequestAttemptLogsTotal,
    getSetting, setSetting
} from '../db/index.js';
import { initializeAccount, refreshAccessToken, fetchProjectId, fetchQuotaInfo, fetchDetailedQuotaInfo } from '../services/tokenManager.js';
import { accountPool, getPinnedAccountSetting, getPoolStrategy, POOL_STRATEGIES } from '../services/accountPool.js';
import { startHealthCheck, getHealthCheckStatus, checkSingleAccount } from '../services/healthCheck.js';

// 仪表盘「今日」统计的时区偏移（分钟）
// 例如中国时间（UTC+8）可设置为 480，默认使用服务器本地时间（0 表示不偏移）
const DASHBOARD_TZ_OFFSET_MINUTES = Number(process.env.DASHBOARD_TZ_OFFSET_MINUTES || 0);

function groupStoredQuotaBuckets(rows) {
    const groups = new Map();
    for (const row of rows) {
        if (!groups.has(row.group_id)) {
            groups.set(row.group_id, { groupId: row.group_id, displayName: row.group_id, buckets: [] });
        }
        groups.get(row.group_id).buckets.push({
            bucketId: row.bucket_id,
            remainingFraction: row.remaining_fraction,
            resetTime: row.reset_time,
            window: null,
            disabled: false
        });
    }
    return [...groups.values()];
}

/** 「用完再换」模式下各额度分组当前在用的账号：{ claude: { id, email }, gemini: { id, email } } */
function describeStickyAccounts() {
    const out = {};
    for (const [family, id] of Object.entries(accountPool.getStickyAccounts())) {
        const account = getAccountById(Number(id));
        out[family] = { id: Number(id), email: account?.email || null };
    }
    return out;
}

function parseCredits(raw) {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function getDayStart(timestamp, offsetMinutes) {
    // 将时间平移到目标时区，取该时区的 00:00，再平移回 UTC 毫秒时间戳
    const shifted = timestamp + offsetMinutes * 60 * 1000;
    const d = new Date(shifted);
    d.setHours(0, 0, 0, 0);
    return d.getTime() - offsetMinutes * 60 * 1000;
}

export default async function adminRoutes(fastify) {
    // 所有管理路由需要认证
    fastify.addHook('preHandler', verifyAdmin);

    // ==================== 仪表盘 ====================

    // GET /admin/dashboard
    fastify.get('/admin/dashboard', async () => {
        const now = Date.now();
        const todayStart = getDayStart(now, DASHBOARD_TZ_OFFSET_MINUTES);

        const accounts = getAllAccounts();
        const todayAttemptStats = getRequestAttemptStats(todayStart, now);  // 请求次数和成功率
        const todayRequestStats = getRequestStats(todayStart, now);          // token 统计
        const modelAttemptUsage = getModelAttemptUsageStats(todayStart, now); // 模型请求次数（基于 attempt）
        const modelTokenUsage = getModelUsageStats(todayStart, now);          // 模型 token（基于 request）
        const poolStats = accountPool.getPoolStats();

        // 合并模型统计：次数用 attempt 表，token 用 request 表
        const tokenMap = new Map(modelTokenUsage.map(m => [m.model, m.tokens || 0]));
        const modelUsage = modelAttemptUsage.map(m => ({
            model: m.model,
            count: m.count,
            tokens: tokenMap.get(m.model) || 0
        }));

        return {
            accounts: {
                total: accounts.length,
                active: accounts.filter(a => a.status === 'active').length,
                error: accounts.filter(a => a.status === 'error').length
            },
            today: {
                requests: todayAttemptStats.total_requests || 0,
                tokens: todayRequestStats.total_tokens || 0,
                successRate: todayAttemptStats.total_requests > 0
                    ? ((todayAttemptStats.success_count / todayAttemptStats.total_requests) * 100).toFixed(1)
                    : 100,
                avgLatency: Math.round(todayAttemptStats.avg_latency || 0)
            },
            modelUsage,
            pool: poolStats
        };
    });

    // ==================== 账号管理 ====================

    // GET /admin/accounts
    fastify.get('/admin/accounts', async () => {
        const bucketsByAccount = new Map();
        for (const row of getAllQuotaBuckets()) {
            if (!bucketsByAccount.has(row.account_id)) bucketsByAccount.set(row.account_id, []);
            bucketsByAccount.get(row.account_id).push({
                groupId: row.group_id,
                bucketId: row.bucket_id,
                remainingFraction: row.remaining_fraction,
                resetTime: row.reset_time,
                updatedAt: row.updated_at
            });
        }
        const accounts = getAllAccounts().map(({ ai_credits, ...a }) => ({
            ...a,
            quotaBuckets: bucketsByAccount.get(a.id) || [],
            aiCredits: parseCredits(ai_credits)
        }));
        return { accounts };
    });

    // GET /admin/accounts/export - 导出所有账号（email + refresh_token + project_id）
    fastify.get('/admin/accounts/export', async () => {
        const accounts = getAllAccountsForRefresh();
        const exportData = accounts.map(a => ({
            email: a.email,
            refresh_token: a.refresh_token,
            project_id: a.project_id || null
        }));
        return { accounts: exportData };
    });

    // GET /admin/accounts/:id
    fastify.get('/admin/accounts/:id', async (request) => {
        const { id } = request.params;
        const account = getAccountById(id);

        if (!account) {
            return { error: { message: 'Account not found' } };
        }

        // 隐藏敏感信息
        delete account.refresh_token;
        delete account.access_token;

        return { account };
    });

    // POST /admin/accounts
    fastify.post('/admin/accounts', async (request, reply) => {
        const { email, refresh_token, project_id } = request.body;

        if (!refresh_token) {
            return reply.code(400).send({
                error: { message: 'refresh_token is required' }
            });
        }

        try {
            const accountId = createAccount(email || null, refresh_token, project_id || null);
            const account = getAccountById(accountId);

            // 初始化账号（刷新 token + 获取 email/projectId）
            try {
                await initializeAccount(account);
            } catch (initError) {
                // 检查账号是否被删除（重复账号情况）
                const stillExists = getAccountById(accountId);
                if (!stillExists) {
                    return reply.code(400).send({
                        error: { message: initError.message }
                    });
                }
                // 初始化失败（无效的 refresh token 等），删除幽灵账号
                deleteAccount(accountId);
                return reply.code(400).send({
                    error: { message: initError.message || '账号初始化失败，refresh_token 可能无效' }
                });
            }

            const latest = getAccountById(accountId);
            if (!latest) {
                return reply.code(400).send({
                    error: { message: '账号创建后丢失' }
                });
            }
            return {
                success: true,
                accountId,
                email: latest?.email || email || null,
                project_id: latest?.project_id || project_id || null,
                tier: latest?.tier || null,
                message: 'Account created successfully'
            };
        } catch (error) {
            if (error.message.includes('UNIQUE constraint')) {
                return reply.code(400).send({
                    error: { message: 'Account with this email already exists' }
                });
            }
            throw error;
        }
    });

    // POST /admin/accounts/batch
    fastify.post('/admin/accounts/batch', async (request) => {
        const { accounts } = request.body;

        if (!Array.isArray(accounts)) {
            return { error: { message: 'accounts must be an array' } };
        }

        const results = [];

        for (const acc of accounts) {
            if (!acc.refresh_token) {
                results.push({ email: acc.email || '(unknown)', success: false, error: 'refresh_token is required' });
                continue;
            }

            try {
                const accountId = createAccount(acc.email || null, acc.refresh_token, acc.project_id || null);
                const account = getAccountById(accountId);

                try {
                    await initializeAccount(account);
                } catch (initError) {
                    // 检查账号是否被删除（重复账号情况）
                    const stillExists = getAccountById(accountId);
                    if (!stillExists) {
                        results.push({ email: acc.email || '(unknown)', success: false, error: initError.message });
                        continue;
                    }
                    // 初始化失败（无效的 refresh token 等），删除幽灵账号
                    deleteAccount(accountId);
                    results.push({ email: acc.email || '(unknown)', success: false, error: initError.message || '账号初始化失败，refresh_token 可能无效' });
                    continue;
                }

                const latest = getAccountById(accountId);
                if (!latest) {
                    results.push({ email: acc.email || '(unknown)', success: false, error: '账号创建后丢失' });
                    continue;
                }
                results.push({
                    email: latest?.email || acc.email || '(unknown)',
                    success: true,
                    accountId,
                    project_id: latest?.project_id || acc.project_id || null,
                    tier: latest?.tier || null
                });
            } catch (error) {
                // 处理 UNIQUE constraint 错误，显示友好信息
                if (error.message.includes('UNIQUE constraint')) {
                    results.push({ email: acc.email || '(unknown)', success: false, error: `账号 ${acc.email || ''} 已存在` });
                } else {
                    results.push({ email: acc.email || '(unknown)', success: false, error: error.message });
                }
            }
        }

        return { results };
    });

    // PUT /admin/accounts/:id/status
    fastify.put('/admin/accounts/:id/status', async (request) => {
        const { id } = request.params;
        const { status } = request.body;

        if (!['active', 'disabled', 'error'].includes(status)) {
            return { error: { message: 'Invalid status' } };
        }

        updateAccountStatus(id, status);
        return { success: true };
    });

    // POST /admin/accounts/:id/refresh
    fastify.post('/admin/accounts/:id/refresh', async (request) => {
        const { id } = request.params;
        const account = getAccountById(id);

        if (!account) {
            return { error: { message: 'Account not found' } };
        }

        try {
            const refreshed = await refreshAccessToken(account);
            // 确保后续请求使用新 token
            account.access_token = refreshed.access_token;
            // 同步 projectId/tier（tier 历史上可能一直停留在 free-tier）
            if (!account.project_id || !account.tier || account.tier === 'free-tier') {
                await fetchProjectId(account);
            }
            await fetchQuotaInfo(account);
            const latest = getAccountById(id);
            return {
                success: true,
                message: 'Token refreshed',
                project_id: latest?.project_id || account.project_id || null,
                tier: latest?.tier || account.tier || null
            };
        } catch (error) {
            return { error: { message: error.message } };
        }
    });

    // GET /admin/accounts/:id/quota - 获取账号详细配额
    fastify.get('/admin/accounts/:id/quota', async (request) => {
        const { id } = request.params;
        const account = getAccountById(id);

        if (!account) {
            return { error: { message: 'Account not found' } };
        }

        try {
            const quotaInfo = await fetchDetailedQuotaInfo(account);
            // 详情弹窗需要显示 refresh_token（与 /admin/accounts/export 同为管理接口，暴露范围一致）
            quotaInfo.refreshToken = account.refresh_token || null;
            const storedBuckets = getAccountQuotaBuckets(id);
            if (quotaInfo.quotaGroups.length === 0 && storedBuckets.length > 0) {
                quotaInfo.quotaGroups = groupStoredQuotaBuckets(storedBuckets);
                quotaInfo.quotaSummaryStatus = 'stale';
            }
            return { success: true, data: quotaInfo };
        } catch (error) {
            return { error: { message: error.message } };
        }
    });

    // DELETE /admin/accounts/:id
    fastify.delete('/admin/accounts/:id', async (request) => {
        const { id } = request.params;
        deleteAccount(id);
        return { success: true };
    });

    // POST /admin/accounts/refresh-all
    fastify.post('/admin/accounts/refresh-all', async () => {
        const accounts = getAllAccountsForRefresh();
        const results = [];

        for (const account of accounts) {
            try {
                const refreshed = await refreshAccessToken(account);
                account.access_token = refreshed.access_token;

                // 同步 projectId/tier（强制一次，避免长期显示 free-tier）
                await fetchProjectId(account);

                // 同步配额
                await fetchQuotaInfo(account);

                results.push({ id: account.id, email: account.email, success: true, project_id: account.project_id || null });
            } catch (error) {
                results.push({ id: account.id, email: account.email, success: false, error: error.message });
            }
        }

        const successCount = results.filter(r => r.success).length;
        return {
            success: true,
            message: `Refreshed ${successCount}/${results.length} accounts (token + quota)`,
            results
        };
    });

    // POST /admin/accounts/health-check  body: { probe?: boolean, probeModel?: string }
    // 后台启动一键健康检测，立即返回任务进度；已有任务在跑时返回该任务
    fastify.post('/admin/accounts/health-check', async (request) => {
        const { probe = true, probeModel } = request.body || {};
        return { success: true, job: startHealthCheck({ probe, probeModel }) };
    });

    // POST /admin/accounts/:id/health-check  body: { probe?: boolean }
    // 同步检测单个账号，直接返回结果（约 3~10 秒）
    fastify.post('/admin/accounts/:id/health-check', async (request, reply) => {
        const { probe = true } = request.body || {};
        const result = await checkSingleAccount(request.params.id, { probe });
        if (!result) return reply.code(404).send({ error: { message: 'Account not found' } });
        return { success: true, result };
    });

    // GET /admin/accounts/health-check  当前或最近一次检测的进度与结果
    fastify.get('/admin/accounts/health-check', async () => {
        return { success: true, job: getHealthCheckStatus() };
    });

    // ==================== 请求日志 ====================

    // GET /admin/logs
    fastify.get('/admin/logs', async (request) => {
        const { limit = 100, offset = 0, model, account_id, status, start_time, end_time } = request.query;

        const filters = {
            model,
            accountId: account_id ? parseInt(account_id) : null,
            status,
            startTime: start_time ? parseInt(start_time) : null,
            endTime: end_time ? parseInt(end_time) : null
        };
        const logs = getRequestLogs(parseInt(limit), parseInt(offset), filters);
        const total = getRequestLogsTotal(filters);

        return { logs, total };
    });

    // GET /admin/logs/attempts - attempt-level logs (one upstream call per row)
    fastify.get('/admin/logs/attempts', async (request) => {
        const { limit = 100, offset = 0, model, account_id, status, request_id, start_time, end_time } = request.query;

        const filters = {
            requestId: request_id || null,
            model,
            accountId: account_id ? parseInt(account_id) : null,
            status,
            startTime: start_time ? parseInt(start_time) : null,
            endTime: end_time ? parseInt(end_time) : null
        };
        const logs = getRequestAttemptLogs(parseInt(limit), parseInt(offset), filters);
        const total = getRequestAttemptLogsTotal(filters);

        return { logs, total };
    });

    // GET /admin/stats
    fastify.get('/admin/stats', async (request) => {
        const { start_time, end_time } = request.query;
        const now = Date.now();
        const startTime = start_time ? parseInt(start_time) : now - 24 * 60 * 60 * 1000;
        const endTime = end_time ? parseInt(end_time) : now;

        const stats = getRequestAttemptStats(startTime, endTime);
        const modelUsage = getModelUsageStats(startTime, endTime);

        return { stats, modelUsage };
    });

    // ==================== 系统设置 ====================

    // GET /admin/settings
    fastify.get('/admin/settings', async () => {
        return {
            defaultModel: getSetting('defaultModel', 'gemini-2.5-flash'),
            pollingStrategy: getPoolStrategy(),
            stickyAccounts: describeStickyAccounts(),
            pinnedAccount: getPinnedAccountSetting()
        };
    });

    // PUT /admin/pool-strategy  body: { strategy: 'round-robin' | 'sticky' }
    // 全局选号策略：每次请求换号 / 一个号用完额度再换下一个
    fastify.put('/admin/pool-strategy', async (request, reply) => {
        const { strategy } = request.body || {};
        if (!POOL_STRATEGIES.includes(strategy)) {
            return reply.code(400).send({ error: { message: `strategy 只能是 ${POOL_STRATEGIES.join(' / ')}` } });
        }
        setSetting('pollingStrategy', strategy);
        return { success: true, pollingStrategy: strategy, stickyAccounts: describeStickyAccounts() };
    });

    // PUT /admin/pinned-account  body: { id: number|null, strict?: boolean }
    // 指定所有请求固定使用某个账号；id 为 null 时取消指定，恢复轮询
    fastify.put('/admin/pinned-account', async (request) => {
        const { id, strict = true } = request.body || {};
        if (id === null || id === undefined || id === '') {
            setSetting('pinnedAccount', null);
            return { success: true, pinnedAccount: null };
        }
        const account = getAccountById(Number(id));
        if (!account) return { error: { message: `账号 id=${id} 不存在` } };
        const value = { id: account.id, strict: strict !== false };
        setSetting('pinnedAccount', value);
        return { success: true, pinnedAccount: value, email: account.email };
    });

    // PUT /admin/settings
    fastify.put('/admin/settings', async (request) => {
        const { key, value } = request.body;

        if (!key) {
            return { error: { message: 'key is required' } };
        }

        setSetting(key, value);
        return { success: true };
    });
}
