/**
 * 账号健康检测
 *
 * 对每个账号依次执行：刷新 token → 补齐 project_id → 同步额度 →（可选）发一条极小的测试请求，
 * 按结果给出 ok / warn / fail 三级结论。检测在后台运行，前端轮询进度。
 * 最近一次结果写入 settings.lastHealthCheck，重启后仍可查看。
 */
import { getAllAccounts, getAllAccountsForRefresh, getAccountById, getAccountQuotaBuckets, getSetting, setSetting } from '../db/index.js';
import { refreshAccessToken, fetchProjectId, fetchQuotaInfo } from './tokenManager.js';
import { chat } from './antigravity.js';
import { convertOpenAIToAntigravity } from './converter/openai-converter.js';

const SETTING_KEY = 'lastHealthCheck';
const CONCURRENCY = 4;
const DEFAULT_PROBE_MODEL = 'gemini-3-flash';

let currentJob = null;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function shortError(error) {
    return String(error?.message || error || '').replace(/\s+/g, ' ').slice(0, 300);
}

function isNetworkError(error) {
    // tokenManager 只在拿到 Google 的 HTTP 响应时抛出 "Token refresh failed: ..."，其余均为网络层失败
    return !String(error?.message || '').startsWith('Token refresh failed');
}

const TRANSIENT_PATTERN = /fetch failed|TLS handshake|ECONNRESET|ETIMEDOUT|timeout|EOF|socket hang up/i;

function isTransientResult(r) {
    return r.level === 'warn' && TRANSIENT_PATTERN.test(String(r.detail || ''));
}

function classifyTokenError(error) {
    const msg = shortError(error);
    if (/invalid_grant/i.test(msg)) {
        return { level: 'fail', reason: 'token_invalid', message: 'refresh_token 已失效（invalid_grant），需要重新 OAuth 授权', detail: msg };
    }
    return { level: 'fail', reason: 'token_refresh_failed', message: 'Token 刷新被 Google 拒绝', detail: msg };
}

function classifyProbeError(error) {
    const status = error?.upstreamStatus;
    const body = `${error?.upstreamBody || ''} ${error?.message || ''}`;
    const detail = shortError(error);
    if (status === 403 && /VALIDATION_REQUIRED|Verify your account/i.test(body)) {
        return { level: 'fail', reason: 'needs_verification', message: 'Google 要求在网页上验证账号（403 VALIDATION_REQUIRED）', detail };
    }
    if (status === 401) {
        return { level: 'fail', reason: 'unauthorized', message: '测试请求认证失败（401）', detail };
    }
    if (status === 403) {
        return { level: 'fail', reason: 'forbidden', message: '测试请求被拒绝（403）', detail };
    }
    if (status === 429) {
        return { level: 'warn', reason: 'rate_limited', message: '测试模型额度用完或被限流（429），账号本身可连接', detail };
    }
    return { level: 'warn', reason: 'probe_error', message: '测试请求失败（可能是网络或上游临时错误）', detail };
}

/** 从 account_quota_buckets 取 Claude / Gemini 的 5h 与周额度剩余比例 */
function summarizeQuota(accountId) {
    const pick = {};
    for (const row of getAccountQuotaBuckets(accountId) || []) {
        pick[row.bucket_id] = { remaining: row.remaining_fraction, resetTime: row.reset_time };
    }
    return {
        claude5h: pick['3p-5h'] || null,
        claudeWeekly: pick['3p-weekly'] || null,
        gemini5h: pick['gemini-5h'] || null,
        geminiWeekly: pick['gemini-weekly'] || null
    };
}

function quotaNotes(quota) {
    const notes = [];
    const exhausted = q => q && typeof q.remaining === 'number' && q.remaining <= 0;
    if (exhausted(quota.claudeWeekly) || exhausted(quota.claude5h)) notes.push('Claude 额度已用完');
    if (exhausted(quota.geminiWeekly) || exhausted(quota.gemini5h)) notes.push('Gemini 额度已用完');
    return notes;
}

async function refreshWithRetry(account) {
    try {
        return await refreshAccessToken(account);
    } catch (error) {
        if (!isNetworkError(error)) throw error;
        await sleep(1000);
        return refreshAccessToken(account);
    }
}

async function probeAccount(account, probeModel) {
    const req = convertOpenAIToAntigravity({
        model: probeModel,
        messages: [{ role: 'user', content: 'reply with exactly: ok' }],
        max_tokens: 256,
        stream: false
    }, account.project_id || '');
    req.project = account.project_id || '';
    if (account.session_id) req.request.sessionId = account.session_id;
    const t0 = Date.now();
    await chat(account, req);
    return Date.now() - t0;
}

async function checkAccount(account, options) {
    const startedAt = Date.now();
    const result = {
        id: account.id,
        email: account.email,
        tier: account.tier,
        statusBefore: account.status,
        level: 'ok',
        reason: 'ok',
        message: '正常',
        detail: null,
        notes: [],
        probeLatencyMs: null,
        quota: null
    };
    const fail = (info) => Object.assign(result, info);

    // 1. 刷新 token
    try {
        await refreshWithRetry(account);
    } catch (error) {
        if (isNetworkError(error)) {
            fail({ level: 'warn', reason: 'network', message: '连接 Google 失败（网络错误，账号状态未知）', detail: shortError(error) });
        } else {
            fail(classifyTokenError(error));
        }
        result.elapsedMs = Date.now() - startedAt;
        return result;
    }

    // 2. 补齐 project_id
    if (!account.project_id) {
        try {
            await fetchProjectId(account);
        } catch (error) {
            fail({ level: 'fail', reason: 'no_project', message: '无法获取 project_id，账号不能发请求', detail: shortError(error) });
            result.elapsedMs = Date.now() - startedAt;
            return result;
        }
    }

    // 3. 同步额度（失败不致命）
    try {
        await fetchQuotaInfo(account);
    } catch (error) {
        fail({ level: 'warn', reason: 'quota_failed', message: '额度同步失败', detail: shortError(error) });
    }
    result.quota = summarizeQuota(account.id);
    result.notes = quotaNotes(result.quota);

    // 4. 测试请求：能发现 token 正常但实际被 Google 拦截的号（如需要网页验证）
    if (options.probe) {
        try {
            result.probeLatencyMs = await probeAccount(account, options.probeModel);
        } catch (error) {
            const info = classifyProbeError(error);
            // 额度同步的警告不应盖过测试请求的失败
            if (info.level === 'fail' || result.level === 'ok') fail(info);
        }
    }

    result.elapsedMs = Date.now() - startedAt;
    return result;
}

function publicJob(job) {
    if (!job) return null;
    const { results, ...rest } = job;
    return { ...rest, results: [...results].sort((a, b) => a.id - b.id) };
}

async function runJob(job, accounts, options) {
    let cursor = 0;
    const worker = async () => {
        while (cursor < accounts.length) {
            const account = accounts[cursor++];
            let res;
            try {
                res = await checkAccount(account, options);
            } catch (error) {
                res = {
                    id: account.id, email: account.email, tier: account.tier, statusBefore: account.status,
                    level: 'warn', reason: 'internal_error', message: '检测过程出错', detail: shortError(error), notes: []
                };
            }
            job.results.push(res);
            job.done = job.results.length;
        }
    };

    try {
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, accounts.length) }, worker));

        // 网络抖动（TLS 握手 EOF / 超时 / fetch failed）不代表账号有问题：并发结束后逐个重测一次
        const transient = job.results.filter(isTransientResult);
        if (transient.length > 0) {
            job.retrying = transient.length;
            for (const prev of transient) {
                const account = accounts.find(a => a.id === prev.id);
                if (!account) continue;
                await sleep(500);
                let res;
                try {
                    res = await checkAccount(account, options);
                } catch {
                    continue;
                }
                res.retried = true;
                const idx = job.results.findIndex(r => r.id === prev.id);
                if (idx >= 0) job.results[idx] = res;
                job.retrying--;
            }
            job.retrying = 0;
        }
    } finally {
        job.running = false;
        job.finishedAt = Date.now();
        job.summary = {
            ok: job.results.filter(r => r.level === 'ok').length,
            warn: job.results.filter(r => r.level === 'warn').length,
            fail: job.results.filter(r => r.level === 'fail').length,
            skipped: job.skipped.length
        };
        try {
            setSetting(SETTING_KEY, publicJob(job));
        } catch (error) {
            console.error('[HealthCheck] save result failed:', error.message);
        }
        console.log(`[HealthCheck] finished: ok=${job.summary.ok} warn=${job.summary.warn} fail=${job.summary.fail} skipped=${job.summary.skipped}`);
    }
}

/**
 * 启动检测；已有任务在跑时直接返回该任务
 * @param {{ probe?: boolean, probeModel?: string }} options
 */
export function startHealthCheck(options = {}) {
    if (currentJob?.running) return publicJob(currentJob);

    const opts = {
        probe: options.probe !== false,
        probeModel: String(options.probeModel || DEFAULT_PROBE_MODEL)
    };
    const accounts = getAllAccountsForRefresh();
    const skipped = getAllAccounts()
        .filter(a => a.status === 'disabled')
        .map(a => ({ id: a.id, email: a.email }));

    currentJob = {
        id: Date.now(),
        running: true,
        startedAt: Date.now(),
        finishedAt: null,
        options: opts,
        total: accounts.length,
        done: 0,
        results: [],
        skipped,
        summary: null
    };
    runJob(currentJob, accounts, opts).catch(error => console.error('[HealthCheck] job crashed:', error));
    return publicJob(currentJob);
}

/**
 * 同步检测单个账号（与批量检测相同的四步），遇到网络抖动自动重测一次
 * @returns {Promise<object|null>} 检测结果；账号不存在返回 null
 */
export async function checkSingleAccount(id, options = {}) {
    const account = getAccountById(Number(id));
    if (!account) return null;
    const opts = {
        probe: options.probe !== false,
        probeModel: String(options.probeModel || DEFAULT_PROBE_MODEL)
    };
    let res = await checkAccount(account, opts);
    if (isTransientResult(res)) {
        await sleep(500);
        res = { ...(await checkAccount(account, opts)), retried: true };
    }
    res.checkedAt = Date.now();
    mergeIntoLastResult(res);
    return res;
}

/** 把单号结果合并进最近一次批量结果，弹窗里看到的状态与列表保持一致 */
function mergeIntoLastResult(res) {
    const target = currentJob && !currentJob.running ? currentJob : null;
    const saved = target ? null : getSetting(SETTING_KEY, null);
    const job = target || saved;
    if (!job || job.running || !Array.isArray(job.results)) return;
    const idx = job.results.findIndex(r => r.id === res.id);
    if (idx >= 0) job.results[idx] = res;
    else job.results.push(res);
    job.summary = {
        ok: job.results.filter(r => r.level === 'ok').length,
        warn: job.results.filter(r => r.level === 'warn').length,
        fail: job.results.filter(r => r.level === 'fail').length,
        skipped: Array.isArray(job.skipped) ? job.skipped.length : 0
    };
    try {
        setSetting(SETTING_KEY, publicJob(job));
    } catch (error) {
        console.error('[HealthCheck] save single result failed:', error.message);
    }
}

/** 当前任务进度；进程重启后返回上次保存的结果 */
export function getHealthCheckStatus() {
    if (currentJob) return publicJob(currentJob);
    return getSetting(SETTING_KEY, null);
}
