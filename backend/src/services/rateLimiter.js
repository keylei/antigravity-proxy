// 简单的模型并发限流器：限制每个模型的上游并发请求数
// 目的是避免在本地直接把某个模型打爆，尽量减少 500，靠更平滑的并发来“爽用”额度。

function parseBoolean(value, defaultValue = false) {
    if (value === undefined || value === null || value === '') return defaultValue;
    const v = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
    return defaultValue;
}

const DISABLE_LOCAL_LIMITS = parseBoolean(process.env.DISABLE_LOCAL_LIMITS, false);
// 每个模型最大并发数（默认 0 = 不限制）
const MAX_CONCURRENT_PER_MODEL = Number(process.env.MAX_CONCURRENT_PER_MODEL || 0);

// key: model id, value: 当前并发数
const inFlightPerModel = new Map();

export function acquireModelSlot(model) {
    if (DISABLE_LOCAL_LIMITS) return true;
    if (!Number.isFinite(MAX_CONCURRENT_PER_MODEL) || MAX_CONCURRENT_PER_MODEL <= 0) return true;

    const key = model || 'default';
    const current = inFlightPerModel.get(key) || 0;

    if (current >= MAX_CONCURRENT_PER_MODEL) {
        return false;
    }

    inFlightPerModel.set(key, current + 1);
    return true;
}

export function releaseModelSlot(model) {
    if (DISABLE_LOCAL_LIMITS) return;
    if (!Number.isFinite(MAX_CONCURRENT_PER_MODEL) || MAX_CONCURRENT_PER_MODEL <= 0) return;

    const key = model || 'default';
    const current = inFlightPerModel.get(key) || 0;
    if (current <= 1) {
        inFlightPerModel.delete(key);
    } else {
        inFlightPerModel.set(key, current - 1);
    }
}
