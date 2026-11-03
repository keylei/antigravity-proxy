/**
 * Antigravity 版本自动获取服务
 * 定期从官方 auto-updater API 拉取最新版本号，实现 user_agent 热更新。
 * 同时支持响应式刷新：当上游返回 outdated 响应时可即时触发。
 */
import { setAgVersion, getAgVersion } from '../config.js';

const VERSION_API = 'https://antigravity-auto-updater-974169037036.us-central1.run.app/releases';
const DEFAULT_INTERVAL_MS = 60 * 60_000; // 1 小时
const DEBOUNCE_MS = 30_000; // 防抖窗口 30 秒

let _intervalId = null;
let _lastRefreshTime = 0;
let _refreshPromise = null;

/**
 * 从 auto-updater API 获取最新版本号
 * @returns {string|null} 版本号或 null
 */
async function fetchLatestVersion() {
    const resp = await fetch(VERSION_API, {
        headers: { 'User-Agent': 'AntigravityProxy/VersionFetcher' },
        signal: AbortSignal.timeout(10_000)
    });
    if (!resp.ok) return null;
    const releases = await resp.json();
    if (!Array.isArray(releases) || releases.length === 0) return null;
    const latest = releases[0]?.version;
    return typeof latest === 'string' && /^\d+\.\d+\.\d+/.test(latest) ? latest : null;
}

/**
 * 执行一次版本检查并更新
 */
async function checkAndUpdate() {
    try {
        const latest = await fetchLatestVersion();
        if (!latest) return;

        const current = getAgVersion();
        if (latest !== current) {
            setAgVersion(latest);
            console.log(`[VersionFetcher] 版本更新: ${current} -> ${latest}`);
        }
    } catch (err) {
        console.warn(`[VersionFetcher] 获取版本失败: ${err.message}`);
    }
}

/**
 * 启动版本自动获取定时任务
 */
export function startVersionFetcher() {
    if (_intervalId) return;

    const intervalMs = Math.max(60_000, Number(process.env.AG_VERSION_CHECK_INTERVAL_MS || DEFAULT_INTERVAL_MS));

    // 启动时立即获取一次
    checkAndUpdate().then(() => {
        console.log(`[VersionFetcher] 当前版本: ${getAgVersion()}, 检查间隔: ${Math.round(intervalMs / 60_000)}min`);
    });

    _intervalId = setInterval(checkAndUpdate, intervalMs);
}

/**
 * 停止定时任务
 */
export function stopVersionFetcher() {
    if (_intervalId) {
        clearInterval(_intervalId);
        _intervalId = null;
    }
}

/**
 * 响应式即时刷新（带防抖）
 * 当检测到 outdated 响应时调用，30 秒内只实际请求一次。
 * @returns {Promise<boolean>} 版本是否发生变化
 */
export async function refreshVersion() {
    const now = Date.now();
    // 防抖：30 秒内复用上次请求
    if (_refreshPromise && (now - _lastRefreshTime) < DEBOUNCE_MS) {
        return _refreshPromise;
    }

    _lastRefreshTime = now;
    _refreshPromise = (async () => {
        const before = getAgVersion();
        await checkAndUpdate();
        const after = getAgVersion();
        return before !== after;
    })();

    try {
        return await _refreshPromise;
    } finally {
        _refreshPromise = null;
    }
}

/**
 * 检测文本是否为上游版本过期提示
 */
export function isVersionOutdatedText(text) {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim();
    // JSON 或 SSE 格式的响应不是 outdated 纯文本提示
    if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('data:')) return false;
    const lower = trimmed.toLowerCase();
    return (
        lower.includes('out of date') ||
        lower.includes('no longer supported') ||
        lower.includes('antigravity.google/download') ||
        (lower.includes('please update') && lower.includes('latest')) ||
        (lower.includes('version') && lower.includes('antigravity'))
    );
}
