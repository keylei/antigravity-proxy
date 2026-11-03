/**
 * Warmup 启动序列 + Heartbeat 保活
 *
 * Warmup: 模拟官方客户端启动时的初始化 RPC 调用链
 * Heartbeat: 持续心跳维持 Token 活跃状态
 *
 * 参考：zerogravity/src/warmup.rs, antigravity2api-nodejs/src/api/client.js
 */
import { ANTIGRAVITY_CONFIG } from '../config.js';
import { fingerprintFetch } from '../runtime/fingerprint-requester.js';

const BASE_URL = ANTIGRAVITY_CONFIG.base_url;
const API_HOST = new URL(BASE_URL).host;
const HEARTBEAT_INTERVAL_MS = 1_000;  // 1 秒（匹配真实客户端 setInterval(1000)）
const HEARTBEAT_JITTER_MS = 50;       // ±50ms（模拟 JS setInterval 精度）
const IDLE_TIMEOUT_MS = 3 * 60_000;   // 3 分钟无请求则暂停心跳

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function randomDelay(minMs = 50, maxMs = 200) {
    return sleep(minMs + Math.random() * (maxMs - minMs));
}

function getHeaders(account) {
    return {
        'Host': API_HOST,
        'User-Agent': ANTIGRAVITY_CONFIG.user_agent,
        'Authorization': `Bearer ${account.access_token}`,
        'Content-Type': 'application/json',
        'Accept-Encoding': 'gzip'
    };
}

async function callEndpoint(account, path, body = {}) {
    try {
        await fingerprintFetch(`${BASE_URL}${path}`, {
            method: 'POST',
            headers: getHeaders(account),
            body: JSON.stringify(body)
        });
    } catch { /* 静默失败 */ }
}

/**
 * 执行 Warmup 启动序列
 * 模拟官方客户端启动时按顺序调用的初始化端点
 */
export async function runWarmupSequence(account) {
    if (!account.access_token) return;

    const sequence = [
        { path: '/v1internal:onboardUser', body: { tierId: account.tier || 'standard-tier', metadata: { ideType: 'ANTIGRAVITY', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' } } },
        { path: '/v1internal:fetchAvailableModels', body: { project: account.project_id || '' } },
        { path: '/v1internal:loadCodeAssist', body: { metadata: { ideType: 'ANTIGRAVITY', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' } } },
        { path: '/v1internal:recordCodeAssistMetrics', body: { metrics: [] } },
    ];

    for (const step of sequence) {
        await callEndpoint(account, step.path, step.body);
        await randomDelay(50, 200);
    }
}

// ==================== Heartbeat 管��� ====================

// accountId -> { timerId, lastActivity }
const heartbeatTimers = new Map();

/**
 * 记录账号活动（外部请求到来时调用，用于判断是否 idle）
 */
export function touchAccountActivity(accountId) {
    const entry = heartbeatTimers.get(accountId);
    if (entry) {
        entry.lastActivity = Date.now();
    }
}

/**
 * 为单个账号启动 heartbeat
 */
export function startHeartbeat(account) {
    if (heartbeatTimers.has(account.id)) return;

    const entry = {
        lastActivity: Date.now(),
        timerId: null,
        account
    };

    const tick = async () => {
        // 检查 idle 超时
        if (Date.now() - entry.lastActivity > IDLE_TIMEOUT_MS) {
            return; // 跳过本次心跳，但不停止定时器
        }

        try {
            await callEndpoint(entry.account, '/v1internal:recordCodeAssistMetrics', { metrics: [] });
        } catch { /* ignore */ }
    };

    const scheduleNext = () => {
        const jitter = (Math.random() - 0.5) * 2 * HEARTBEAT_JITTER_MS;
        entry.timerId = setTimeout(() => {
            tick().finally(scheduleNext);
        }, HEARTBEAT_INTERVAL_MS + jitter);
    };

    scheduleNext();
    heartbeatTimers.set(account.id, entry);
}

/**
 * 停止单个账号的 heartbeat
 */
export function stopHeartbeat(accountId) {
    const entry = heartbeatTimers.get(accountId);
    if (entry) {
        clearTimeout(entry.timerId);
        heartbeatTimers.delete(accountId);
    }
}

/**
 * 更新 heartbeat 使用的 account 对象（Token 刷新后调用）
 */
export function updateHeartbeatAccount(account) {
    const entry = heartbeatTimers.get(account.id);
    if (entry) {
        entry.account = account;
    }
}

/**
 * 批量启动所有活跃账号的 heartbeat
 */
export function startAllHeartbeats(accounts) {
    for (const account of accounts) {
        if (account.status === 'active' && account.access_token) {
            startHeartbeat(account);
        }
    }
}

/**
 * 停止所有 heartbeat
 */
export function stopAllHeartbeats() {
    for (const [id] of heartbeatTimers) {
        stopHeartbeat(id);
    }
}
