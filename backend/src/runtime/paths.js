/**
 * 运行时路径工具
 * 支持开发环境和打包环境的路径解析
 */
import path from 'node:path';

/**
 * 检测是否在打包环境中运行
 * pkg 会在运行时设置 process.pkg
 */
export function isPackaged() {
    return Boolean(process.pkg);
}

/**
 * 获取基准目录
 * - 打包环境：可执行文件所在目录
 * - 开发环境：当前工作目录
 */
export function getBaseDir() {
    return isPackaged() ? path.dirname(process.execPath) : process.cwd();
}

/**
 * 解析运行时路径
 * 将相对路径转换为基于基准目录的绝对路径
 * @param {string} p - 路径
 * @returns {string} 解析后的绝对路径
 */
export function resolveRuntimePath(p) {
    if (p === undefined || p === null) return p;
    const s = String(p);
    if (s === '' || path.isAbsolute(s)) return s;
    return path.resolve(getBaseDir(), s);
}
