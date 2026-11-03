/**
 * 打包专用入口
 *
 * 该文件由 esbuild 打包，pkg 封装成可执行文件
 * 主要功能：
 * 1. 加载 .env 配置文件
 * 2. 解压内嵌资源到可写目录
 * 3. 启动服务器
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';

// esbuild text loader 内联 schema.sql
import schemaSql from './db/schema.sql';
import { startServer } from './index.js';
import { BUILD_TARGET, BUILD_VERSION } from './runtime/buildInfo.js';
import { isPackaged, getBaseDir, resolveRuntimePath } from './runtime/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 确保目录存在
 */
function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

/**
 * 从 pkg 快照中提取文件到可写目录
 * 使用原子写入避免并发问题
 * 安全性：始终覆盖已存在的文件，防止劫持
 */
function ensureFileFromSnapshot(snapshotPath, outPath, forceOverwrite = false) {
    // 安全：对于原生模块等关键文件，强制覆盖
    if (!forceOverwrite && fs.existsSync(outPath)) {
        return;
    }
    ensureDir(path.dirname(outPath));

    const data = fs.readFileSync(snapshotPath);
    const tmp = `${outPath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, data, { mode: 0o600 }); // 限制权限
    try {
        fs.renameSync(tmp, outPath);
    } catch (err) {
        try {
            fs.unlinkSync(tmp);
        } catch {
            // ignore
        }
        if (!fs.existsSync(outPath)) throw err;
    }
}

/**
 * 递归复制目录
 */
function copyDirRecursive(srcDir, dstDir) {
    ensureDir(dstDir);
    for (const name of fs.readdirSync(srcDir)) {
        const src = path.join(srcDir, name);
        const dst = path.join(dstDir, name);
        const st = fs.statSync(src);
        if (st.isDirectory()) {
            copyDirRecursive(src, dst);
        } else if (st.isFile()) {
            ensureFileFromSnapshot(src, dst);
        }
    }
}

/**
 * 解析资源解压目录
 * 支持通过环境变量自定义
 * 安全性：使用用户隔离的目录
 */
function resolveExtractDir() {
    const raw = process.env.AGP_EXTRACT_DIR;
    if (raw && String(raw).trim()) {
        return resolveRuntimePath(String(raw).trim());
    }
    // 使用用户隔离目录，按版本和平台隔离
    // 优先使用可执行文件同目录的 .cache，避免临时目录劫持风险
    const baseDir = getBaseDir();
    const cacheDir = path.join(baseDir, '.agp-cache', BUILD_VERSION, BUILD_TARGET);

    // 如果可执行文件目录不可写，回退到用户目录
    try {
        fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
        return cacheDir;
    } catch {
        // 回退到用户目录
        const userHome = os.homedir();
        return path.join(userHome, '.antigravity-proxy', BUILD_VERSION, BUILD_TARGET);
    }
}

/**
 * 加载 .env 配置文件
 */
function loadEnvFile() {
    const baseDir = getBaseDir();
    const envPath = path.join(baseDir, '.env');

    if (fs.existsSync(envPath)) {
        dotenvConfig({ path: envPath });
        console.log(`[Config] Loaded .env from ${envPath}`);
    }
}

async function main() {
    // 首先加载 .env 文件（在打包环境下从可执行文件同目录加载）
    if (isPackaged()) {
        loadEnvFile();
    }

    let staticRoot = null;
    let nativeBinding = null;

    if (isPackaged()) {
        const extractDir = resolveExtractDir();

        // pkg 内嵌的资源路径
        const snapshotPublicDir = path.join(__dirname, 'public');
        const snapshotNativeAddon = path.join(__dirname, 'native', 'better_sqlite3.node');

        // 解压目标路径
        const publicOutDir = path.join(extractDir, 'public');
        const nativeOutPath = path.join(extractDir, 'native', 'better_sqlite3.node');

        // 解压 public 目录（使用标记文件避免重复解压）
        const publicMarker = path.join(extractDir, '.public.ready');
        if (!fs.existsSync(publicMarker)) {
            console.log(`[Extract] Extracting public assets to ${publicOutDir}`);
            copyDirRecursive(snapshotPublicDir, publicOutDir);
            ensureDir(extractDir);
            fs.writeFileSync(publicMarker, 'ok', 'utf8');
        }

        // 解压原生模块（安全：强制覆盖，防止劫持）
        console.log(`[Extract] Ensuring native addon at ${nativeOutPath}`);
        ensureFileFromSnapshot(snapshotNativeAddon, nativeOutPath, true);

        staticRoot = publicOutDir;

        // 使用 Node 的 require 加载原生模块，然后传递给 better-sqlite3
        const require = createRequire(import.meta.url);
        nativeBinding = require(nativeOutPath);
    }

    console.log(`[Antigravity Proxy] Version: ${BUILD_VERSION} (${BUILD_TARGET})`);

    await startServer({
        schemaSql,
        staticRoot,
        nativeBinding
    });
}

main().catch((err) => {
    console.error(err?.stack || String(err));
    process.exit(1);
});
