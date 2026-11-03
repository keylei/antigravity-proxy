/**
 * 安全转义工具函数
 */

/**
 * HTML 转义
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}

/**
 * HTML 属性值转义
 */
export function escapeAttr(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * URL 参数转义
 */
export function escapeUrl(str) {
  if (str === null || str === undefined) return '';
  return encodeURIComponent(String(str));
}

/**
 * CSS 值转义
 */
export function escapeCss(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[^\w-]/g, c => `\\${c.charCodeAt(0).toString(16)} `);
}

/**
 * 正则表达式转义
 */
export function escapeRegex(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 简写别名
export const esc = escapeHtml;

export default {
  escapeHtml,
  escapeAttr,
  escapeUrl,
  escapeCss,
  escapeRegex,
  esc
};