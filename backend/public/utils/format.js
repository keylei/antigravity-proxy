/**
 * 格式化工具函数
 */

/**
 * 格式化时间戳
 * @param {number|string} ts - 时间戳
 * @param {Object} options - 格式化选项
 */
export function formatTime(ts, options = {}) {
  if (!ts) return '-';
  
  try {
    const date = new Date(typeof ts === 'string' ? ts : Number(ts));
    
    if (isNaN(date.getTime())) return '-';

    const defaultOptions = {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    };

    return date.toLocaleString('zh-CN', { ...defaultOptions, ...options });
  } catch {
    return '-';
  }
}

/**
 * 格式化日期（不含时间）
 */
export function formatDate(ts) {
  return formatTime(ts, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: undefined,
    minute: undefined,
    second: undefined
  });
}

/**
 * 格式化相对时间
 */
export function formatRelativeTime(ts) {
  if (!ts) return '-';
  
  try {
    const date = new Date(typeof ts === 'string' ? ts : Number(ts));
    const now = new Date();
    const diff = now - date;
    
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    
    return formatDate(ts);
  } catch {
    return '-';
  }
}

/**
 * 格式化数字（千分位）
 */
export function formatNumber(n, fallback = '-') {
  if (n === null || n === undefined) return fallback;
  if (typeof n !== 'number' || isNaN(n)) return fallback;
  
  return n.toLocaleString('zh-CN');
}

/**
 * 格式化字节大小
 */
export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 B';
  if (!bytes || typeof bytes !== 'number') return '-';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

/**
 * 格式化百分比
 */
export function formatPercent(value, decimals = 1) {
  if (value === null || value === undefined) return '-';
  if (typeof value !== 'number' || isNaN(value)) return '-';

  return value.toFixed(decimals) + '%';
}

/**
 * 格式化持续时间（毫秒）
 */
export function formatDuration(ms) {
  if (!ms || typeof ms !== 'number') return '-';

  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export default {
  formatTime,
  formatDate,
  formatRelativeTime,
  formatNumber,
  formatBytes,
  formatPercent,
  formatDuration
};