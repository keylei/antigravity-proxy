/**
 * 直连模式下的「多 IP 容错」本地隧道
 *
 * 背景：在 TUN（如 SkyVPN / sing-tun）模式下，同一个 Google 域名解析出的多个 IP 中，
 * 常有一部分经 VPN 节点无法完成 TLS 握手（表现为 handshake failed / ECONNRESET），
 * 而 Go 指纹二进制与 Node fetch 都只会拿第一个 IP 去连，导致请求随机失败。
 *
 * 做法：未配置 OUTBOUND_PROXY 时，在 127.0.0.1 随机端口启动一个只支持 CONNECT 的本地隧道，
 * 并把 OUTBOUND_PROXY 指向它。隧道对目标域名的每个 IP 先用 TLS 握手探测，
 * 只把连接转发到握手成功的 IP；TLS 仍由客户端端到端完成，TLS 指纹不受影响。
 *
 * 关闭：DIRECT_IP_FAILOVER=0
 */
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';

const GOOD_TTL_MS = 30 * 60 * 1000;   // 健康 IP 缓存 30 分钟
const BAD_TTL_MS = 10 * 60 * 1000;    // 失败 IP 屏蔽 10 分钟
const PROBE_TIMEOUT_MS = 5000;

const ipHealth = new Map();     // `${host}|${ip}` -> { ok, until }
const preferred = new Map();    // `${host}:${port}` -> { ip, until }
const inflight = new Map();     // `${host}:${port}` -> Promise<string>

function mark(host, ip, ok) {
    ipHealth.set(`${host}|${ip}`, { ok, until: Date.now() + (ok ? GOOD_TTL_MS : BAD_TTL_MS) });
    if (!ok) {
        for (const [key, v] of preferred) {
            if (key.startsWith(`${host}:`) && v.ip === ip) preferred.delete(key);
        }
    }
}

function health(host, ip) {
    const h = ipHealth.get(`${host}|${ip}`);
    if (!h || Date.now() > h.until) return null;
    return h.ok;
}

async function resolveAll(host) {
    if (net.isIP(host)) return [host];
    try {
        const v4 = await dns.promises.resolve4(host);
        if (v4.length > 0) return v4;
    } catch { /* fall through */ }
    const all = await dns.promises.lookup(host, { all: true, family: 4 });
    return all.map(a => a.address);
}

function probeTls(host, ip, port) {
    return new Promise((resolve) => {
        const sock = tls.connect({ host: ip, port, servername: host, ALPNProtocols: ['http/1.1'], timeout: PROBE_TIMEOUT_MS });
        const done = (ok) => { sock.destroy(); resolve(ok); };
        sock.once('secureConnect', () => done(true));
        sock.once('timeout', () => done(false));
        sock.once('error', () => done(false));
    });
}

async function pickIp(host, port) {
    const key = `${host}:${port}`;
    const cached = preferred.get(key);
    if (cached && Date.now() < cached.until) return cached.ip;
    if (inflight.has(key)) return inflight.get(key);

    const task = (async () => {
        const ips = await resolveAll(host);
        if (ips.length <= 1 || port !== 443) return ips[0];
        // 已知健康的优先，未知的其次，已知失败的最后
        const order = [...ips].sort((a, b) => {
            const rank = (ip) => { const h = health(host, ip); return h === true ? 0 : h === null ? 1 : 2; };
            return rank(a) - rank(b);
        });
        for (const ip of order) {
            const known = health(host, ip);
            if (known === true) { preferred.set(key, { ip, until: Date.now() + GOOD_TTL_MS }); return ip; }
            if (known === false) continue;
            const ok = await probeTls(host, ip, port);
            mark(host, ip, ok);
            if (ok) { preferred.set(key, { ip, until: Date.now() + GOOD_TTL_MS }); return ip; }
        }
        // 全部失败：退回第一个，让上层报真实错误
        console.warn(`[DirectDial] ${host}: ${ips.length} 个 IP 均无法完成 TLS 握手`);
        return ips[0];
    })().finally(() => inflight.delete(key));

    inflight.set(key, task);
    return task;
}

function handleConnect(req, clientSocket, head) {
    // 必须立即挂上：pickIp 探测期间客户端若断开（ECONNRESET），无监听的 'error' 会让整个进程崩溃
    let upstream = null;
    clientSocket.on('error', () => { if (upstream) upstream.destroy(); });
    const [host, portStr] = String(req.url || '').split(':');
    const port = Number(portStr || 443);
    if (!host || !Number.isFinite(port)) {
        clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        return;
    }

    pickIp(host, port).then((ip) => {
        if (clientSocket.destroyed) return;
        upstream = net.connect({ host: ip, port });
        let gotUpstreamData = false;
        upstream.once('connect', () => {
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head && head.length) upstream.write(head);
            upstream.pipe(clientSocket);
            clientSocket.pipe(upstream);
        });
        upstream.on('data', () => { gotUpstreamData = true; });
        upstream.on('error', (err) => {
            // 服务端一个字节都没回就断开：视为该 IP 在当前网络下不可用
            if (!gotUpstreamData && port === 443) mark(host, ip, false);
            if (!clientSocket.destroyed) {
                if (clientSocket.writable && !gotUpstreamData) clientSocket.end(`HTTP/1.1 502 Bad Gateway\r\n\r\n`);
                else clientSocket.destroy(err);
            }
        });
        clientSocket.on('close', () => upstream.destroy());
        upstream.on('close', () => clientSocket.destroy());
    }).catch((err) => {
        if (clientSocket.destroyed) return;
        clientSocket.end(`HTTP/1.1 502 Bad Gateway\r\nX-Error: ${String(err.message).replace(/[\r\n]/g, ' ')}\r\n\r\n`);
    });
}

/**
 * 未配置任何出站代理时启动本地隧道，并把 OUTBOUND_PROXY 指向它。
 * 必须在 configureGlobalFetchDispatcher() 之前调用。
 */
export async function startDirectFailoverTunnel() {
    const configured = process.env.OUTBOUND_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    if (configured) return null;
    const flag = String(process.env.DIRECT_IP_FAILOVER ?? '1').toLowerCase();
    if (['0', 'false', 'no', 'off'].includes(flag)) return null;

    const { createServer } = await import('node:http');
    const server = createServer((req, res) => {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('CONNECT only');
    });
    server.on('connect', handleConnect);

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    server.unref();

    const { port } = server.address();
    process.env.OUTBOUND_PROXY = `http://127.0.0.1:${port}`;
    console.log(`[DirectDial] 直连模式：已启用多 IP 容错隧道 127.0.0.1:${port}`);
    return server;
}
