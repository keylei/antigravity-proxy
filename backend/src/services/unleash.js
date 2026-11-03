/**
 * Unleash 心跳服务
 * 模拟官方 Antigravity 客户端的 Unleash 功能开关心跳，
 * 向 antigravity-unleash.goog 定期发送 register / features / frontend 请求。
 *
 * 参考：antigravity2api-nodejs/src/utils/unleash.js
 */
import crypto from 'crypto';
import { fingerprintFetch } from '../runtime/fingerprint-requester.js';
import { UNLEASH_TOKENS, getAgVersion } from '../config.js';

const UNLEASH_BASE = 'https://antigravity-unleash.goog';
const UNLEASH_INTERVAL_MS = 60_000; // 60 秒
const UNLEASH_JITTER_MS = 5_000;    // ±5 秒抖动
// Frontend 端点使用 Electron GUI 版本号，与 Go CLI 版本不同
const ELECTRON_VERSION = '1.107.0';
const FULL_CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Antigravity/${ELECTRON_VERSION} Chrome/142.0.7444.175 Electron/39.2.3 Safari/537.36`;

// Per-account persistent connection IDs (Go client + Electron frontend)
const _connectionIds = new Map();
// Per-account ETag cache for /api/client/features conditional requests
const _featureETags = new Map();
// Per-account persistent started timestamp (set once, reused across heartbeats)
const _startedTimestamps = new Map();
function getConnectionIds(accountId) {
    if (!_connectionIds.has(accountId)) {
        _connectionIds.set(accountId, {
            goClient: crypto.randomUUID(),
            electron: crypto.randomUUID()
        });
    }
    return _connectionIds.get(accountId);
}

// 构造 Go time.Now() 风格的时间戳（本地时区 + 纳秒精度，尾部零裁剪）
function generateGoTimestamp() {
    const now = new Date();
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    const Y = now.getFullYear();
    const M = pad(now.getMonth() + 1);
    const D = pad(now.getDate());
    const h = pad(now.getHours());
    const m = pad(now.getMinutes());
    const s = pad(now.getSeconds());
    // 毫秒 + 随机微秒/纳秒，裁剪尾部零
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    const nano = ms + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    const trimmed = nano.replace(/0+$/, '') || '0';
    // 本地时区偏移
    const offMin = -now.getTimezoneOffset();
    const offSign = offMin >= 0 ? '+' : '-';
    const offH = pad(Math.floor(Math.abs(offMin) / 60));
    const offM = pad(Math.abs(offMin) % 60);
    return `${Y}-${M}-${D}T${h}:${m}:${s}.${trimmed}${offSign}${offH}:${offM}`;
}

// 获取每个账号持久化的 started 时间戳（整个进程生命周期内不变）
function getStartedTimestamp(accountId) {
    if (!_startedTimestamps.has(accountId)) {
        _startedTimestamps.set(accountId, generateGoTimestamp());
    }
    return _startedTimestamps.get(accountId);
}

function buildClientRegisterBody(account) {
    return {
        appName: 'codeium-language-server',
        instanceId: account.instance_id,
        connectionId: getConnectionIds(account.id).goClient,
        sdkVersion: 'unleash-client-go:4.5.0',
        strategies: ['default', 'applicationHostname', 'gradualRolloutRandom', 'gradualRolloutSessionId', 'gradualRolloutUserId', 'remoteAddress', 'userWithId', 'flexibleRollout'],
        started: getStartedTimestamp(account.id),
        interval: 60,
        platformVersion: 'go1.27-20260209-RC00 cl/867831283 +86f7959aa6 X:boringcrypto,simd',
        platformName: 'go',
        yggdrasilVersion: null,
        specVersion: '4.3.1'
    };
}

function buildFrontEndBody(account) {
    return {
        context: {
            environment: 'default',
            appName: 'codeium-extension',
            sessionId: '',
            userId: account.access_token,
            properties: {
                devMode: 'false',
                extensionVersion: '',
                hasAnthropicModelAccess: 'false',
                ide: 'antigravity',
                ideVersion: getAgVersion(),
                installationId: account.session_id || crypto.randomUUID(),
                language: 'UNSPECIFIED',
                os: 'windows',
                requestedModelId: 'MODEL_UNSPECIFIED',
                userTierId: account.tier || 'g1-pro-tier'
            }
        }
    };
}

// ==================== 三套独立请求头 ====================

function getRegisterHeaders(account) {
    const body = JSON.stringify(buildClientRegisterBody(account));
    const connIds = getConnectionIds(account.id);
    return {
        'Host': 'antigravity-unleash.goog',
        'User-Agent': 'codeium-language-server',
        'Content-Length': String(Buffer.byteLength(body, 'utf8')),
        'Authorization': `*:${UNLEASH_TOKENS.client}`,
        'Content-Type': 'application/json',
        'Unleash-Appname': 'codeium-language-server',
        'Unleash-Connection-Id': connIds.goClient,
        'Unleash-Instanceid': account.instance_id || '',
        'Unleash-Interval': '60000',
        'Unleash-Sdk': 'unleash-client-go:4.5.0',
        'Accept-Encoding': 'gzip',
        _body: body
    };
}

function getFeaturesHeaders(account) {
    const connIds = getConnectionIds(account.id);
    const headers = {
        'Host': 'antigravity-unleash.goog',
        'User-Agent': 'codeium-language-server',
        'Authorization': `*:${UNLEASH_TOKENS.client}`,
        'Unleash-Appname': 'codeium-language-server',
        'Unleash-Client-Spec': '4.3.1',
        'Unleash-Connection-Id': connIds.goClient,
        'Unleash-Instanceid': account.instance_id || '',
        'Unleash-Interval': '60000',
        'Unleash-Sdk': 'unleash-client-go:4.5.0',
        'Accept-Encoding': 'gzip'
    };
    const etag = _featureETags.get(account.id);
    if (etag) {
        headers['If-None-Match'] = etag;
    }
    return headers;
}

function getFrontEndHeaders(account) {
    const body = JSON.stringify(buildFrontEndBody(account));
    const connIds = getConnectionIds(account.id);
    return {
        'Host': 'antigravity-unleash.goog',
        'User-Agent': FULL_CHROME_UA,
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'en-US',
        'Authorization': `*:${UNLEASH_TOKENS.frontend}`,
        'Cache-Control': 'max-age=0',
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(body, 'utf8')),
        'Origin': 'vscode-file://vscode-app',
        'Priority': 'u=1, i',
        'Sec-Ch-Ua': '"Not_A Brand";v="99", "Chromium";v="142"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': 'Windows',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'cross-site',
        'Unleash-Appname': 'codeium-extension',
        'Unleash-Connection-Id': connIds.electron,
        'Unleash-Sdk': 'unleash-client-js:3.7.8',
        _body: body
    };
}

async function sendRegister(account) {
    try {
        const headers = getRegisterHeaders(account);
        const body = headers._body;
        delete headers._body;
        await fingerprintFetch(`${UNLEASH_BASE}/api/client/register`, {
            method: 'POST',
            headers,
            body,
            alpn: true
        });
    } catch { /* 静默失败，不影响主业务 */ }
}

async function sendFeatures(account) {
    try {
        const resp = await fingerprintFetch(`${UNLEASH_BASE}/api/client/features`, {
            method: 'GET',
            headers: getFeaturesHeaders(account),
            alpn: true
        });
        // 缓存 ETag，下次请求带 If-None-Match（模拟真实客户端条件请求）
        const etag = resp.headers?.['etag'] || resp.headers?.['Etag'];
        if (etag) {
            _featureETags.set(account.id, etag);
        }
    } catch { /* 静默 */ }
}

async function sendFrontEnd(account) {
    try {
        const headers = getFrontEndHeaders(account);
        const body = headers._body;
        delete headers._body;
        await fingerprintFetch(`${UNLEASH_BASE}/api/frontend`, {
            method: 'POST',
            headers,
            body,
            alpn: true
        });
    } catch { /* 静默 */ }
}

// ==================== Metrics 端点 ====================

// Go 客户端功能开关评估统计（从真实抓包提取）
// 格式: [name, yes, no, variants]
const GO_TOGGLES = [
    ['BROWSER_STATE_DIFF_ENABLED', 1, 0, { disabled: 1 }],
    ['CASCADE_AUTO_FIX_LINTS', 0, 1, { disabled: 1 }],
    ['CASCADE_ENABLE_MCP_TOOLS', 0, 1, { disabled: 1 }],
    ['CASCADE_GLOBAL_CONFIG_OVERRIDE', 1, 0, { 'turn-off-injected-message': 1 }],
    ['CASCADE_PLAN_BASED_CONFIG_OVERRIDE', 0, 1, { disabled: 1 }],
    ['CASCADE_USE_EXPERIMENT_CHECKPOINTER', 1, 0, { FLASH_LITE: 1 }],
    ['CASCADE_USE_REPLACE_CONTENT_EDIT_TOOL', 1, 0, { 'no-fallback': 1 }],
    ['CASCADE_VIEW_FILE_TOOL_CONFIG_OVERRIDE', 0, 1, { disabled: 1 }],
    ['COLLAPSE_ASSISTANT_MESSAGES', 0, 1, { disabled: 1 }],
    ['ENABLE_SUGGESTED_RESPONSES', 0, 1, { disabled: 1 }],
    ['IMPLICIT_USES_CLIPBOARD', 6, 0, { disabled: 6 }],
    ['MODEL_LLAMA_3_1_70B_INSTRUCT_LONG_CONTEXT_VARIANTS', 1, 0, { default: 1 }],
    ['SNAPSHOT_TO_STEP_OPTIONS_OVERRIDE', 7, 0, { more_content_telemetry: 6, more_view_file_steps: 1 }],
    ['USE_ANTHROPIC_TOKEN_EFFICIENT_TOOLS_BETA', 0, 1, { disabled: 1 }],
    ['VIDEO_SUMMARIZATION_MODEL', 1, 0, { GEMINI_RIFTRUNNER: 1 }],
    ['VIEWED_FILE_TRACKER_CONFIG', 0, 6, { disabled: 6 }],
    ['XML_TOOL_PARSING_MODELS', 0, 1, { disabled: 1 }],
    ['add-session-id', 1, 0, { disabled: 1 }],
    ['browser-get-network-request-enabled', 1, 0, { disabled: 1 }],
    ['browser-interactions-num-implicit-steps', 0, 6, { disabled: 6 }],
    ['browser-list-network-requests-enabled', 1, 0, { disabled: 1 }],
    ['browser-subagent-model', 1, 0, { fiercefalcon: 1 }],
    ['cascade-api-server-experiment-keys', 1, 0, { all: 1 }],
    ['cascade-browser-subagent-max-context-tokens', 1, 0, { disabled: 1 }],
    ['cascade-browser-subagent-reminder', 1, 0, { VerifyWork: 1 }],
    ['cascade-command-status-tool-config-override', 1, 0, { delta: 1 }],
    ['cascade-conversation-history-config', 1, 0, { enabled: 1 }],
    ['cascade-disable-append-ephemeral', 0, 1, { disabled: 1 }],
    ['cascade-disable-simple-research-tools', 0, 1, { disabled: 1 }],
    ['cascade-enable-invoke-subagent-tool', 0, 1, { disabled: 1 }],
    ['cascade-enable-messaging', 0, 1, { disabled: 1 }],
    ['cascade-enable-notebook-edit-tool', 0, 1, { disabled: 1 }],
    ['cascade-enable-search-in-file-tool', 0, 1, { disabled: 1 }],
    ['cascade-executor-config', 1, 0, { queue_all_steps: 1 }],
    ['cascade-grep-tool-config-override', 0, 1, { disabled: 1 }],
    ['cascade-include-browser-ephemeral-message', 1, 0, { screenshot_and_dom: 1 }],
    ['cascade-include-ephemeral-message', 1, 0, { enabled: 1 }],
    ['cascade-knowledge-config', 1, 0, { enabled: 1 }],
    ['cascade-split-dynamic-prompt-sections', 1, 0, { disabled: 1 }],
    ['cascade-third-party-web-search', 0, 1, { disabled: 1 }],
    ['cascade-tool-description-override', 0, 1, { disabled: 1 }],
    ['cascade-trajectory-search-tool-config-override', 1, 0, { disable: 1 }],
    ['cascade-trajectory-to-artifact-conversion', 0, 1, { disabled: 1 }],
    ['cascade-view-code-item-tool-config-override', 0, 1, { disabled: 1 }],
    ['code-acknowledgement-model-converter-config', 0, 1, { disabled: 1 }],
    ['enable-checkpoint-fallback', 1, 0, { disabled: 1 }],
    ['gemini-xml-tool-fixes', 0, 1, { disabled: 1 }],
    ['implicit-include-running', 6, 0, { disabled: 6 }],
    ['implicit-uses-lint-diff', 0, 6, { disabled: 6 }],
    ['implicit-uses-open-browser-url', 0, 6, { disabled: 6 }],
    ['implicit-uses-user-grep', 6, 0, { disabled: 6 }],
    ['min-required-lint-duration', 0, 6, { disabled: 6 }],
    ['native-gemini-tool-calling', 0, 1, { disabled: 1 }],
    ['task-boundary-tool-config', 0, 1, { disabled: 1 }],
    ['use-responses-api', 0, 1, { disabled: 1 }],
];

function buildGoToggles() {
    const toggles = {};
    for (const [name, yes, no, variants] of GO_TOGGLES) {
        toggles[name] = { yes, no, variants };
    }
    return toggles;
}

function buildClientMetricsBody(account) {
    const now = new Date();
    const start = new Date(now.getTime() - 60_000);
    // Go 客户端用 Go 风格时间戳
    const formatGo = (d) => {
        const pad = (n, w = 2) => String(n).padStart(w, '0');
        const ms = String(d.getMilliseconds()).padStart(3, '0');
        const nano = ms + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
        const trimmed = nano.replace(/0+$/, '') || '0';
        const offMin = -d.getTimezoneOffset();
        const offSign = offMin >= 0 ? '+' : '-';
        const offH = pad(Math.floor(Math.abs(offMin) / 60));
        const offM = pad(Math.abs(offMin) % 60);
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${trimmed}${offSign}${offH}:${offM}`;
    };
    return {
        appName: 'codeium-language-server',
        instanceId: account.instance_id,
        connectionId: getConnectionIds(account.id).goClient,
        bucket: {
            start: formatGo(start),
            stop: formatGo(now),
            toggles: buildGoToggles()
        },
        platformVersion: 'go1.27-20260209-RC00 cl/867831283 +86f7959aa6 X:boringcrypto,simd',
        platformName: 'go',
        yggdrasilVersion: null,
        sdkVersion: 'unleash-client-go:4.5.0',
        specVersion: '4.3.1'
    };
}

function buildFrontendMetricsBody() {
    const now = new Date();
    const start = new Date(now.getTime() - 30_000);
    return {
        bucket: {
            start: start.toISOString(),
            stop: now.toISOString(),
            toggles: {
                'LOG_CASCADE_CHAT_PANEL_ERROR': { yes: 0, no: 4, variants: {} }
            }
        },
        appName: 'codeium-extension',
        instanceId: 'browser'
    };
}

function getClientMetricsHeaders(account) {
    const body = JSON.stringify(buildClientMetricsBody(account));
    const connIds = getConnectionIds(account.id);
    return {
        'Host': 'antigravity-unleash.goog',
        'User-Agent': 'codeium-language-server',
        'Authorization': `*:${UNLEASH_TOKENS.client}`,
        'Unleash-Sdk': 'unleash-client-go:4.5.0',
        'Content-Type': 'application/json',
        'Unleash-Appname': 'codeium-language-server',
        'Unleash-Instanceid': account.instance_id || '',
        'Unleash-Interval': '60000',
        'Unleash-Connection-Id': connIds.goClient,
        'Content-Length': String(Buffer.byteLength(body, 'utf8')),
        'Accept-Encoding': 'gzip',
        _body: body
    };
}

function getFrontendMetricsHeaders(account) {
    const body = JSON.stringify(buildFrontendMetricsBody());
    const connIds = getConnectionIds(account.id);
    return {
        'Host': 'antigravity-unleash.goog',
        'User-Agent': FULL_CHROME_UA,
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'en-US',
        'Authorization': `*:${UNLEASH_TOKENS.frontend}`,
        'Cache-Control': 'max-age=0',
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(body, 'utf8')),
        'Origin': 'vscode-file://vscode-app',
        'Priority': 'u=1, i',
        'Sec-Ch-Ua': '"Not_A Brand";v="99", "Chromium";v="142"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': 'Windows',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'cross-site',
        'Unleash-Appname': 'codeium-extension',
        'Unleash-Connection-Id': connIds.electron,
        'Unleash-Sdk': 'unleash-client-js:3.7.8',
        _body: body
    };
}

async function sendClientMetrics(account) {
    try {
        const headers = getClientMetricsHeaders(account);
        const body = headers._body;
        delete headers._body;
        await fingerprintFetch(`${UNLEASH_BASE}/api/client/metrics`, {
            method: 'POST',
            headers,
            body,
            alpn: true
        });
    } catch { /* 静默 */ }
}

async function sendFrontendMetrics(account) {
    try {
        const headers = getFrontendMetricsHeaders(account);
        const body = headers._body;
        delete headers._body;
        await fingerprintFetch(`${UNLEASH_BASE}/api/frontend/client/metrics`, {
            method: 'POST',
            headers,
            body,
            alpn: true
        });
    } catch { /* 静默 */ }
}

/**
 * 对单个账号执行一轮 Unleash 心跳
 */
export async function unleashHeartbeat(account) {
    if (!account.access_token || !account.instance_id) return;
    await sendRegister(account);
    await sendFeatures(account);
    await sendFrontEnd(account);
    await sendClientMetrics(account);
    await sendFrontendMetrics(account);
}

// 定时器管理
let _intervalId = null;

/**
 * 启动 Unleash 心跳调度器
 * @param {Function} getActiveAccounts - 返回所有活跃账号的函数
 */
export function startUnleashScheduler(getActiveAccounts) {
    if (_intervalId) return;

    const run = async () => {
        try {
            const accounts = getActiveAccounts();
            for (const account of accounts) {
                if (account.status !== 'active' || !account.access_token) continue;
                await unleashHeartbeat(account);
                // 每个账号之间加随机延迟，避免并发聚簇
                await new Promise(r => setTimeout(r, 200 + Math.random() * 500));
            }
        } catch { /* ignore */ }
    };

    // 首次执行延迟 10~30 秒（模拟启动延迟）
    setTimeout(() => {
        run();
        _intervalId = setInterval(() => {
            const jitter = Math.floor(Math.random() * UNLEASH_JITTER_MS);
            setTimeout(run, jitter);
        }, UNLEASH_INTERVAL_MS);
    }, 10_000 + Math.random() * 20_000);

    console.log('[Unleash] heartbeat scheduler started');
}

export function stopUnleashScheduler() {
    if (_intervalId) {
        clearInterval(_intervalId);
        _intervalId = null;
    }
}
