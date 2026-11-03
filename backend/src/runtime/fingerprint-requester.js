/**
 * TLS 指纹伪装 fetch 封装
 * 通过调用外部 Go 二进制发送带正确 TLS 指纹的 HTTP 请求，
 * 避免 Node.js 原生 TLS 握手特征暴露。
 *
 * 二进制位于 src/bin/ 目录，按平台自动选择：
 *   - fingerprint_linux_amd64
 *   - fingerprint_windows_amd64.exe
 *
 * TLS 配置位于 src/bin/tls_config.json
 *
 * 对外暴露 fingerprintFetch(url, options) 接口，与原生 fetch() 接口对齐。
 * 当二进制不存在或环境变量 USE_TLS_FINGERPRINT=false 时，自动降级为原生 fetch。
 */
import { spawn } from 'child_process';
import { existsSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';

// 按平台选择二进制文件名
function getBinaryName() {
    const platform = process.platform;   // 'linux', 'win32', 'darwin'
    const arch = process.arch;           // 'x64', 'arm64'
    if (platform === 'win32') return 'fingerprint_windows_amd64.exe';
    if (platform === 'linux' && arch === 'arm64') return 'fingerprint_linux_arm64';
    if (platform === 'linux') return 'fingerprint_linux_amd64';
    if (platform === 'darwin' && arch === 'arm64') return 'fingerprint_darwin_arm64';
    if (platform === 'darwin') return 'fingerprint_darwin_amd64';
    return `fingerprint_${platform}_${arch}`;
}

// 解析 bin 目录：支持源码运行和 pkg 打包两种模式
function resolveBinDir() {
    // pkg 打包后，process.execPath 指向可执行文件，查找同目录下的 bin/
    const pkgBinDir = join(dirname(process.execPath), 'bin');
    if (existsSync(pkgBinDir)) return pkgBinDir;
    // 源码运行：相对于当前文件的 ../bin
    const __dir = dirname(fileURLToPath(import.meta.url));
    return join(__dir, '..', 'bin');
}

const BIN_DIR = resolveBinDir();
const BINARY_PATH = join(BIN_DIR, getBinaryName());
const CONFIG_PATH = join(BIN_DIR, 'tls_config.json');

let _available = null; // 懒初始化：null=未检测, true/false

function isEnabled() {
    const env = (process.env.USE_TLS_FINGERPRINT ?? '').toLowerCase();
    if (env === 'false' || env === '0' || env === 'no') return false;
    return true;
}

function checkAvailable() {
    if (_available !== null) return _available;
    if (!isEnabled()) { _available = false; return false; }
    if (!existsSync(BINARY_PATH) || !existsSync(CONFIG_PATH)) {
        console.warn('[TLS-FP] fingerprint binary or config not found, falling back to native fetch');
        _available = false;
        return false;
    }
    try { chmodSync(BINARY_PATH, 0o755); } catch { /* ignore */ }
    _available = true;
    console.log('[TLS-FP] TLS fingerprint requester initialized');
    return true;
}

function getProxyConfig() {
    const proxyUrl = process.env.OUTBOUND_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    if (!proxyUrl) return undefined;
    return {
        enabled: true,
        type: proxyUrl.startsWith('socks') ? 'socks5' : 'http',
        url: proxyUrl
    };
}

function decompressGzip(buffer) {
    return new Promise((resolve, reject) => {
        zlib.gunzip(buffer, (err, result) => {
            if (err) reject(err); else resolve(result);
        });
    });
}

/**
 * 通过 Go 二进制发送 HTTP 请求
 * @param {string} url
 * @param {Object} options - { method, headers, body, signal, timeout }
 * @returns {Promise<{ ok, status, statusText, headers, text(), json(), body }>}
 */
function binaryFetch(url, options = {}) {
    const { method = 'GET', headers = {}, body, signal, timeout = 120, alpn } = options;

    const requestPayload = {
        method: method.toUpperCase(),
        url,
        headers,
        body: body || '',
        config_path: CONFIG_PATH,
        timeout: { connect: 30, read: timeout },
    };

    if (alpn !== undefined) requestPayload.alpn = !!alpn;
    const proxy = getProxyConfig();
    if (proxy) requestPayload.proxy = proxy;

    return new Promise((resolve, reject) => {
        const proc = spawn(BINARY_PATH);
        let headersParsed = false;
        let responseHeaders = {};
        let responseStatus = 200;
        let responseStatusText = 'OK';
        let headerBuffer = null;
        let bodyChunks = [];
        let stderrData = '';
        // 流式回调列表 — 用于 streamBinaryFetch
        let _onChunk = null;

        const timeoutId = setTimeout(() => {
            proc.kill();
            reject(Object.assign(new Error('Request timeout'), { code: 'ECONNABORTED' }));
        }, (timeout + 10) * 1000);

        if (signal) {
            const onAbort = () => {
                proc.kill();
                clearTimeout(timeoutId);
                reject(Object.assign(new Error('Request aborted'), { code: 'ERR_CANCELED' }));
            };
            if (signal.aborted) { proc.kill(); return reject(Object.assign(new Error('Request aborted'), { code: 'ERR_CANCELED' })); }
            signal.addEventListener('abort', onAbort, { once: true });
        }

        proc.stdout.on('data', (chunk) => {
            if (!headersParsed) {
                headerBuffer = headerBuffer ? Buffer.concat([headerBuffer, chunk]) : chunk;
                const sep = Buffer.from('\r\n\r\n');
                const idx = headerBuffer.indexOf(sep);
                if (idx === -1) return;

                const headerPart = headerBuffer.slice(0, idx).toString('utf8');
                const bodyPart = headerBuffer.slice(idx + 4);
                headerBuffer = null;

                const lines = headerPart.split('\r\n');
                const statusMatch = lines[0].match(/HTTP\/[\d.]+ (\d+) (.*)/);
                responseStatus = statusMatch ? parseInt(statusMatch[1]) : 200;
                responseStatusText = statusMatch ? statusMatch[2] : 'OK';
                for (let i = 1; i < lines.length; i++) {
                    const [key, ...vals] = lines[i].split(': ');
                    if (key) responseHeaders[key.toLowerCase()] = vals.join(': ');
                }
                headersParsed = true;
                clearTimeout(timeoutId);

                if (bodyPart.length > 0) {
                    bodyChunks.push(bodyPart);
                    if (_onChunk) _onChunk(bodyPart.toString('utf8'));
                }
            } else {
                bodyChunks.push(chunk);
                if (_onChunk) _onChunk(chunk.toString('utf8'));
            }
        });

        proc.stderr.on('data', (c) => { stderrData += c.toString(); });

        proc.on('close', async (code) => {
            clearTimeout(timeoutId);
            if (code !== 0) {
                let msg = `fingerprint process exited with code ${code}`;
                if (stderrData) {
                    try { msg = JSON.parse(stderrData).error || msg; } catch { msg = stderrData.trim() || msg; }
                }
                return reject(Object.assign(new Error(msg), { code: 'ERR_NETWORK' }));
            }

            let bodyBuffer = Buffer.concat(bodyChunks);
            const encoding = responseHeaders['content-encoding'] || '';
            const isGzip = bodyBuffer.length >= 2 && bodyBuffer[0] === 0x1f && bodyBuffer[1] === 0x8b;
            if (encoding.toLowerCase().includes('gzip') && isGzip) {
                try { bodyBuffer = await decompressGzip(bodyBuffer); } catch { /* use raw */ }
            }

            const bodyText = bodyBuffer.toString('utf8');
            resolve({
                ok: responseStatus >= 200 && responseStatus < 300,
                status: responseStatus,
                statusText: responseStatusText,
                headers: responseHeaders,
                async text() { return bodyText; },
                async json() { return JSON.parse(bodyText); },
                // body 模拟 — 用于需要 getReader() 的场景
                body: {
                    getReader() {
                        let consumed = false;
                        return {
                            read() {
                                if (consumed) return Promise.resolve({ done: true, value: undefined });
                                consumed = true;
                                return Promise.resolve({ done: false, value: new TextEncoder().encode(bodyText) });
                            },
                            cancel() { consumed = true; }
                        };
                    }
                }
            });
        });

        proc.on('error', (err) => {
            clearTimeout(timeoutId);
            reject(Object.assign(new Error(`Failed to spawn fingerprint binary: ${err.message}`), { code: 'ERR_SPAWN' }));
        });

        // 暴露内部 _onChunk setter，供 streamBinaryFetch 使用
        proc._setOnChunk = (fn) => { _onChunk = fn; };

        proc.stdin.write(JSON.stringify(requestPayload));
        proc.stdin.end();
    });
}

/**
 * 流式 TLS 指纹 fetch — 适用于 SSE 场景
 * 与 binaryFetch 类似，但通过回调实时吐出数据块而非等待全部完成。
 *
 * @param {string} url
 * @param {Object} options - { method, headers, body, signal, timeout }
 * @returns {Promise<{ ok, status, statusText, headers, body: ReadableStream }>}
 */
function streamBinaryFetch(url, options = {}) {
    const { method = 'GET', headers = {}, body, signal, timeout = 300, alpn } = options;

    const requestPayload = {
        method: method.toUpperCase(),
        url,
        headers,
        body: body || '',
        config_path: CONFIG_PATH,
        timeout: { connect: 30, read: timeout },
    };
    if (alpn !== undefined) requestPayload.alpn = !!alpn;
    const proxy = getProxyConfig();
    if (proxy) requestPayload.proxy = proxy;

    return new Promise((resolve, reject) => {
        const proc = spawn(BINARY_PATH);
        let headersParsed = false;
        let responseHeaders = {};
        let responseStatus = 200;
        let responseStatusText = 'OK';
        let headerBuffer = null;
        let stderrData = '';
        let controller; // ReadableStream controller

        const stream = new ReadableStream({
            start(c) { controller = c; },
            cancel() { proc.kill(); }
        });

        const timeoutId = setTimeout(() => {
            proc.kill();
            reject(Object.assign(new Error('Stream request timeout'), { code: 'ECONNABORTED' }));
        }, (timeout + 10) * 1000);

        if (signal) {
            const onAbort = () => {
                proc.kill();
                clearTimeout(timeoutId);
                try { controller.close(); } catch { /* ignore */ }
                reject(Object.assign(new Error('Request aborted'), { code: 'ERR_CANCELED' }));
            };
            if (signal.aborted) { proc.kill(); return reject(Object.assign(new Error('Request aborted'), { code: 'ERR_CANCELED' })); }
            signal.addEventListener('abort', onAbort, { once: true });
        }

        proc.stdout.on('data', (chunk) => {
            if (!headersParsed) {
                headerBuffer = headerBuffer ? Buffer.concat([headerBuffer, chunk]) : chunk;
                const sep = Buffer.from('\r\n\r\n');
                const idx = headerBuffer.indexOf(sep);
                if (idx === -1) return;

                const headerPart = headerBuffer.slice(0, idx).toString('utf8');
                const bodyPart = headerBuffer.slice(idx + 4);
                headerBuffer = null;

                const lines = headerPart.split('\r\n');
                const statusMatch = lines[0].match(/HTTP\/[\d.]+ (\d+) (.*)/);
                responseStatus = statusMatch ? parseInt(statusMatch[1]) : 200;
                responseStatusText = statusMatch ? statusMatch[2] : 'OK';
                for (let i = 1; i < lines.length; i++) {
                    const [key, ...vals] = lines[i].split(': ');
                    if (key) responseHeaders[key.toLowerCase()] = vals.join(': ');
                }
                headersParsed = true;
                clearTimeout(timeoutId);

                // 在 headers 解析完成后 resolve，让调用方可以立即开始读取 body stream
                resolve({
                    ok: responseStatus >= 200 && responseStatus < 300,
                    status: responseStatus,
                    statusText: responseStatusText,
                    headers: responseHeaders,
                    body: { getReader() { return stream.getReader(); } },
                    async text() {
                        const reader = stream.getReader();
                        const chunks = [];
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            chunks.push(value);
                        }
                        return new TextDecoder().decode(Buffer.concat(chunks.map(c =>
                            c instanceof Uint8Array ? Buffer.from(c) : Buffer.from(c)
                        )));
                    }
                });

                if (bodyPart.length > 0) {
                    controller.enqueue(bodyPart);
                }
            } else {
                controller.enqueue(chunk);
            }
        });

        proc.stderr.on('data', (c) => { stderrData += c.toString(); });

        proc.on('close', (code) => {
            clearTimeout(timeoutId);
            try { controller.close(); } catch { /* ignore */ }
            if (!headersParsed) {
                let msg = `fingerprint process exited with code ${code}`;
                if (stderrData) {
                    try { msg = JSON.parse(stderrData).error || msg; } catch { msg = stderrData.trim() || msg; }
                }
                reject(Object.assign(new Error(msg), { code: 'ERR_NETWORK' }));
            }
        });

        proc.on('error', (err) => {
            clearTimeout(timeoutId);
            reject(Object.assign(new Error(`Failed to spawn fingerprint binary: ${err.message}`), { code: 'ERR_SPAWN' }));
        });

        proc.stdin.write(JSON.stringify(requestPayload));
        proc.stdin.end();
    });
}

/**
 * 对外暴露的统一 fetch 接口
 * 自动检测二进制是否可用，不可用时降级为原生 fetch。
 */
export async function fingerprintFetch(url, options = {}) {
    if (!checkAvailable()) return fetch(url, options);
    return binaryFetch(url, options);
}

/**
 * 流式 fetch 接口 — 用于 SSE 等需要实时读取 body 的场景
 * 返回 response 对象，其 body.getReader() 提供流式读取。
 */
export async function fingerprintStreamFetch(url, options = {}) {
    if (!checkAvailable()) return fetch(url, options);
    return streamBinaryFetch(url, options);
}

/** 检查 TLS 指纹是否可用 */
export function isFingerprintAvailable() {
    return checkAvailable();
}
