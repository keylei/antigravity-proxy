/**
 * 遥测日志上报
 * 向上游发送伪造的使用统计数据，模拟真实客户端的遥测行为。
 *
 * 参考：antigravity2api-nodejs/src/utils/recordCodeAssistMetrics.js
 */
import crypto from 'crypto';
import { ANTIGRAVITY_CONFIG, getAgVersion } from '../config.js';
import { fingerprintFetch } from '../runtime/fingerprint-requester.js';

const BASE_URL = ANTIGRAVITY_CONFIG.base_url;
const API_HOST = new URL(BASE_URL).host;
const TELEMETRY_INTERVAL_MS = 5 * 60_000; // 5 分钟基准
const TELEMETRY_JITTER_MS = 5 * 60_000;   // 额外 0~5 分钟随机

let _intervalId = null;

// 构造精确到纳秒的 ISO 时间戳（毫秒后填充随机纳秒）
function generateCreatedAt() {
    const now = new Date();
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    const micro = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    const nano = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    return now.toISOString().replace(/\.\d{3}Z$/, `.${ms}${micro}${nano}Z`);
}

/**
 * 构造 recordCodeAssistMetrics 请求体
 * 匹配 antigravity2api 的 buildRecordCodeAssistMetricsBody 结构
 */
function buildMetrics(account, trajectoryId) {
    const traceId = crypto.randomBytes(8).toString('hex');
    const firstLatency = (Math.random() * 5 + 0.5).toFixed(9);
    const totalLatency = (parseFloat(firstLatency) + Math.random() * 2 + 0.01).toFixed(9);

    return {
        project: account.project_id || '',
        requestId: crypto.randomUUID(),
        metadata: {
            ideType: 'ANTIGRAVITY',
            ideVersion: getAgVersion(),
            platform: 'WINDOWS_AMD64'
        },
        metrics: [
            {
                timestamp: generateCreatedAt(),
                conversationOffered: {
                    status: 'ACTION_STATUS_NO_ERROR',
                    traceId,
                    streamingLatency: {
                        firstMessageLatency: `${firstLatency}s`,
                        totalLatency: `${totalLatency}s`
                    },
                    isAgentic: true,
                    initiationMethod: 'AGENT',
                    trajectoryId: trajectoryId || crypto.randomUUID()
                }
            }
        ]
    };
}

function getMetricsHeaders(account) {
    return {
        'Host': API_HOST,
        'User-Agent': ANTIGRAVITY_CONFIG.user_agent,
        'Authorization': `Bearer ${account.access_token}`,
        'Content-Type': 'application/json',
        'Accept-Encoding': 'gzip'
    };
}

/**
 * 请求级遥测：在真实 API 请求成功后立即调用（fire-and-forget）
 * 参考：antigravity2api 的 sendRecordCodeAssistMetrics，在每次请求后
 * 使用从 requestId 派生的 trajectoryId 发送关联的 metrics。
 *
 * @param {Object} account - 账号对象
 * @param {string} requestId - 真实请求的 requestId（格式 agent/ts/uuid/n）
 */
export async function sendRequestMetrics(account, requestId) {
    if (!account?.access_token) return;
    // 从 requestId 提取 uuid 部分作为 trajectoryId（与 antigravity2api 一致）
    const trajectoryId = requestId?.split('/')[2] || crypto.randomUUID();
    try {
        await fingerprintFetch(`${BASE_URL}/v1internal:recordCodeAssistMetrics`, {
            method: 'POST',
            headers: getMetricsHeaders(account),
            body: JSON.stringify(buildMetrics(account, trajectoryId))
        });
    } catch { /* fire-and-forget */ }
}

/**
 * 定时调度器发送的遥测（后台补充，非请求关联）
 */
async function sendTelemetry(account) {
    if (!account.access_token) return;
    try {
        await fingerprintFetch(`${BASE_URL}/v1internal:recordCodeAssistMetrics`, {
            method: 'POST',
            headers: getMetricsHeaders(account),
            body: JSON.stringify(buildMetrics(account))
        });
    } catch { /* 静默失败 */ }
}

/**
 * 启动遥测上报调度器
 * @param {Function} getActiveAccounts - 返回所有活跃账号的函数
 */
export function startTelemetryScheduler(getActiveAccounts) {
    if (_intervalId) return;

    const run = async () => {
        try {
            const accounts = getActiveAccounts();
            for (const account of accounts) {
                if (account.status !== 'active' || !account.access_token) continue;
                await sendTelemetry(account);
                // 账号间随机间隔
                await new Promise(r => setTimeout(r, 500 + Math.random() * 1500));
            }
        } catch { /* ignore */ }
    };

    // 首次执行延迟 30~60 秒
    setTimeout(() => {
        run();
        _intervalId = setInterval(() => {
            const jitter = Math.random() * TELEMETRY_JITTER_MS;
            setTimeout(run, jitter);
        }, TELEMETRY_INTERVAL_MS);
    }, 30_000 + Math.random() * 30_000);

    console.log('[Telemetry] scheduler started');
}

export function stopTelemetryScheduler() {
    if (_intervalId) {
        clearInterval(_intervalId);
        _intervalId = null;
    }
}
