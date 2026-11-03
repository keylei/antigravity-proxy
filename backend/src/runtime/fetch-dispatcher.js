/**
 * 全局 fetch dispatcher 配置
 * 从 bootstrap.js 提取，支持代理和超时配置
 */
import { Agent, ProxyAgent, setGlobalDispatcher } from 'undici';

function parseIntEnv(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === '') return fallback;
    const n = Number.parseInt(String(raw), 10);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * 配置全局 fetch dispatcher
 * - 支持通过环境变量设置代理
 * - 支持自定义连接超时
 */
export function configureGlobalFetchDispatcher() {
    const connectTimeoutMs = parseIntEnv('FETCH_CONNECT_TIMEOUT_MS', 30000);
    const proxyUrl = process.env.OUTBOUND_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

    try {
        if (proxyUrl) {
            // 让 Node 的全局 fetch 走代理（常用于国内网络 / Clash）
            setGlobalDispatcher(new ProxyAgent({ uri: proxyUrl, connectTimeout: connectTimeoutMs }));
        } else {
            // 提高默认 connect timeout（undici 默认 10s，弱网下易超时）
            setGlobalDispatcher(new Agent({ connectTimeout: connectTimeoutMs }));
        }
    } catch {
        // ignore dispatcher setup failures
    }
}
