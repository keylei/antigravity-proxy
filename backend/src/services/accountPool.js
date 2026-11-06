import { getActiveAccounts, updateAccountLastUsed, updateAccountStatus, updateAccountQuota, getModelAvailabilityRows, getSetting, setSetting, getAccountById, upsertAccountModelQuota } from '../db/index.js';
import { ensureValidToken, fetchQuotaInfo } from './tokenManager.js';
import { RETRY_CONFIG, getMappedModel, AVAILABLE_MODELS, isImageGenerationModel } from '../config.js';

/**
 * 指定账号（固定使用某一个账号）
 * settings.pinnedAccount = { id, strict, replacedFrom?, replacedReason?, replacedAt? }
 *  - strict=true：只用该账号；它不能服务当前模型时直接报错（不换号）
 *  - strict=false：优先用该账号；它额度用完时自动改为指定额度最多的另一个账号
 */
export function getPinnedAccountSetting() {
    const raw = getSetting('pinnedAccount', null);
    const id = Number(raw?.id);
    if (!Number.isFinite(id) || id <= 0) return null;
    return {
        id,
        strict: raw?.strict !== false,
        replacedFrom: raw?.replacedFrom || null,
        replacedReason: raw?.replacedReason || null,
        replacedAt: raw?.replacedAt || null
    };
}

/**
 * 全局选号策略（settings.pollingStrategy）
 *  - round-robin：每次请求按账号 ID 换下一个号，额度平均消耗
 *  - sticky：一直用当前号，直到它额度用完 / 失效，再按 ID 轮到下一个号
 * 指定账号（📍）优先级高于选号策略。旧值 'weighted' 从未生效，按 round-robin 处理。
 */
export const POOL_STRATEGIES = ['round-robin', 'sticky'];

export function getPoolStrategy() {
    return getSetting('pollingStrategy', 'round-robin') === 'sticky' ? 'sticky' : 'round-robin';
}

/**
 * 解析上游「个人额度用完」错误里的重置时间，如
 * "Individual quota reached ... Resets in 136h22m15s." → 毫秒
 */
function parseQuotaResetMs(message) {
    const m = String(message || '').match(/resets? in\s*(?:(\d+)\s*d)?\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?/i);
    if (!m || !(m[1] || m[2] || m[3] || m[4])) return null;
    const [d, h, mi, s] = [m[1], m[2], m[3], m[4]].map(v => Number(v || 0));
    const ms = (((d * 24 + h) * 60 + mi) * 60 + s) * 1000;
    return ms > 0 ? ms : null;
}

// 上游额度按分组共享：Claude + GPT 一组，Gemini 一组（图像模型单独计）
function quotaFamily(model) {
    const m = String(model || '');
    if (/^(claude|gpt)/i.test(m)) return 'claude';
    if (/^gemini/i.test(m) && !isImageGenerationModel(m)) return 'gemini';
    return null;
}

function sameFamilyModels(model) {
    const family = quotaFamily(model);
    if (!family) return [model];
    const all = new Set(AVAILABLE_MODELS.map(x => getMappedModel(x.id)));
    all.add(model);
    return [...all].filter(x => quotaFamily(x) === family);
}

function parseBoolean(value, defaultValue = false) {
    if (value === undefined || value === null || value === '') return defaultValue;
    const v = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
    return defaultValue;
}

const DISABLE_LOCAL_LIMITS = parseBoolean(process.env.DISABLE_LOCAL_LIMITS, false);

// 每个账号允许的最大并发请求数（默认 0 = 不限制）
const MAX_CONCURRENT_PER_ACCOUNT = Number(process.env.MAX_CONCURRENT_PER_ACCOUNT || 0);
// 容量耗尽后的默认冷却时间（毫秒），如果上游返回了具体秒数，会在此基础上调整
const CAPACITY_COOLDOWN_DEFAULT_MS = Number(process.env.CAPACITY_COOLDOWN_DEFAULT_MS || 15000);
const CAPACITY_COOLDOWN_MAX_MS = Number(process.env.CAPACITY_COOLDOWN_MAX_MS || 120000);

function formatClock(ts) {
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDuration(ms) {
    let min = Math.max(0, Math.round(ms / 60000));
    const d = Math.floor(min / 1440); min -= d * 1440;
    const h = Math.floor(min / 60); min -= h * 60;
    return [d && `${d}d`, h && `${h}h`, `${min}m`].filter(Boolean).join(' ');
}

/**
 * 构造「没有可用账号」的明确错误，区分三种原因：
 * - 额度耗尽：账号支持该模型，但上游配额为 0（有 reset 时间）→ 429 + Retry-After
 * - 不支持：账号的上游模型列表里没有该模型（配额被写为 0 且无 reset 时间）
 * - 停用：账号状态不是 active
 */
function buildNoAccountsError(model) {
    if (!model) return new Error('没有可用账号：所有账号均处于禁用或异常状态');

    let rows = [];
    try { rows = getModelAvailabilityRows(model); } catch { /* ignore */ }

    const inactive = rows.filter(r => r.status !== 'active');
    const active = rows.filter(r => r.status === 'active');
    const exhausted = active.filter(r => r.quota_reset_time);
    const unsupported = active.filter(r => !r.quota_reset_time);

    const parts = [];
    let retryAfterMs = null;

    if (exhausted.length > 0) {
        const earliest = Math.min(...exhausted.map(r => r.quota_reset_time));
        const remaining = earliest - Date.now();
        if (remaining > 0) {
            retryAfterMs = remaining;
            parts.push(`${exhausted.length} 个支持该模型的账号额度已耗尽，最早 ${formatClock(earliest)} 恢复（约 ${formatDuration(remaining)} 后）`);
        } else {
            parts.push(`${exhausted.length} 个支持该模型的账号额度已到重置时间，等待下次配额同步（最多 10 分钟），或在管理面板手动刷新账号`);
        }
    }
    if (unsupported.length > 0) {
        parts.push(`${unsupported.length} 个账号不支持该模型`);
    }
    if (inactive.length > 0) {
        parts.push(`${inactive.length} 个账号处于禁用或异常状态`);
    }

    const head = exhausted.length > 0 ? `模型 ${model} 暂无可用额度` : `模型 ${model} 不可用`;
    const err = new Error(`${head}：${parts.join('；') || '没有任何账号'}`);
    err.code = exhausted.length > 0 ? 'model_quota_exhausted' : 'model_not_available';
    if (Number.isFinite(retryAfterMs)) {
        // 标记为容量错误：路由层会返回 429 并带 Retry-After
        err.upstreamStatus = 429;
        err.retryAfterMs = retryAfterMs;
    }
    return err;
}

/**
 * 账号池管理类
 * 实现加权轮询策略，优先使用配额多的账号
 */
class AccountPool {
    constructor() {
        this.lastUsedAccountId = 0; // 全局跟踪上次使用的账号 ID（跨模型共享）
        this.accountLocks = new Map(); // 账号锁，防止并发问题（值为当前并发计数）
        this.capacityCooldowns = new Map(); // 账号在某个模型上的冷却期 key: `${accountId}:${model}` -> timestamp
        this.capacityErrorCounts = new Map(); // 连续容量错误计数 key: `${accountId}:${model}` -> count
        this.errorCounts = new Map(); // 账号错误计数（非容量错误）key: accountId -> count
    }

    /**
     * 获取最优账号
     * 策略：
     * 1. 筛选状态为 active 且配额 > 0 的账号
     * 2. 优先选择配额剩余最多的账号
     * 3. 如果配额相同，选择最近最少使用的账号
     */
    async getBestAccount(model = null) {
        const mappedModel = model ? getMappedModel(model) : null;
        const accounts = getActiveAccounts(mappedModel);

        if (accounts.length === 0) {
            throw buildNoAccountsError(mappedModel);
        }

        let earliestCooldownUntil = null;
        let cooldownCount = 0;

        // 按配额降序、最后使用时间升序排序
        accounts.sort((a, b) => {
            // 首先按配额排序
            if (b.quota_remaining !== a.quota_remaining) {
                return b.quota_remaining - a.quota_remaining;
            }
            // 配额相同时，优先使用最久未使用的账号
            return (a.last_used_at || 0) - (b.last_used_at || 0);
        });

        // 尝试找到一个可用的账号
        for (const account of accounts) {
            // 检查账号并发是否已满
            if (!DISABLE_LOCAL_LIMITS && Number.isFinite(MAX_CONCURRENT_PER_ACCOUNT) && MAX_CONCURRENT_PER_ACCOUNT > 0) {
                const lockCount = this.accountLocks.get(account.id) || 0;
                if (lockCount >= MAX_CONCURRENT_PER_ACCOUNT) {
                    continue;
                }
            }

            // 检查是否处于容量冷却期
            if (!DISABLE_LOCAL_LIMITS && mappedModel && this.isAccountInCooldown(account.id, mappedModel)) {
                cooldownCount += 1;
                const until = this.capacityCooldowns.get(`${account.id}:${mappedModel}`);
                if (until && (!earliestCooldownUntil || until < earliestCooldownUntil)) {
                    earliestCooldownUntil = until;
                }
                continue;
            }

            try {
                // 确保 token 有效
                const validAccount = await ensureValidToken(account);

                // 锁定账号并发
                this.lockAccount(account.id);

                // 更新最后使用时间
                updateAccountLastUsed(account.id);

                return validAccount;
            } catch (err) {
                console.error(`[ACCOUNT_POOL] getBestAccount ensureValidToken failed for account ${account.id} (${account.email}):`, err.message);
                // 继续尝试下一个账号
            }
        }

        // 所有账号都在冷却期：返回 429 + reset after，便于客户端等待后重试
        if (!DISABLE_LOCAL_LIMITS && mappedModel && cooldownCount === accounts.length && earliestCooldownUntil) {
            const remainingMs = Math.max(0, earliestCooldownUntil - Date.now());
            const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
            const messageSeconds = Math.max(0, seconds - 1);
            const err = new Error(`No capacity available, reset after ${messageSeconds}s`);
            err.upstreamStatus = 429;
            err.retryAfterMs = remainingMs;
            throw err;
        }

        throw new Error('No available accounts with valid tokens');
    }

    /**
     * 轮询获取账号（全局严格轮询，跨模型共享索引）
     * 使用账号 ID 而非数组索引跟踪，避免不同模型账号池大小不同导致的错位
     */
    async getNextAccount(model = null, options = null) {
        const mappedModel = model ? getMappedModel(model) : null;

        const pinned = getPinnedAccountSetting();
        if (pinned) {
            const picked = await this._getPinnedAccount(pinned, mappedModel, options);
            if (picked?.account) return picked.account;
            // 兜底：上游报额度用完时 markQuotaExhausted 已直接换号；这里处理由配额同步发现的额度为 0
            if (picked?.exhausted && !pinned.strict) {
                const replacement = await this._replacePinnedAccount(pinned, mappedModel, options, picked.reason);
                if (replacement) return replacement;
            }
            // 其他原因（不支持该模型、临时冷却等）：本次请求回退到正常轮询，不改指定
        }

        const accounts = getActiveAccounts(mappedModel);

        if (accounts.length === 0) {
            throw buildNoAccountsError(mappedModel);
        }

        const excludeIds = new Set();
        if (options && typeof options === 'object') {
            const raw = options.excludeAccountIds;
            if (Array.isArray(raw)) {
                for (const v of raw) {
                    const n = Number(v);
                    if (Number.isFinite(n) && n > 0) {
                        excludeIds.add(n);
                    }
                }
            }
        }

        let earliestCooldownUntil = null;
        let cooldownCount = 0;

        if (getPoolStrategy() === 'sticky') {
            return this._getStickyAccount(accounts, mappedModel, excludeIds);
        }

        // 严格轮询：按 ID 排序，保证稳定顺序
        const ordered = [...accounts].sort((a, b) => (a.id || 0) - (b.id || 0));
        const total = ordered.length;

        // 注意：必须“按最终尝试的账号”推进 lastUsedAccountId。
        // 否则当某个账号因 token/cooldown/并发等原因被跳过时，
        // lastUsedAccountId 仍停留在被跳过的账号上，下一次请求会再次命中同一个“下一个可用账号”，
        // 从而出现“连续两次使用同一账号”的现象。
        //
        // 这里采用“逐个预占位（reservation）”的方式：
        // 每次尝试一个账号前，立即把 lastUsedAccountId 推进到该账号（无 await），
        // 保证并发下不会因异步完成顺序导致指针回退，同时也能在跳过账号时继续向前推进。
        const tried = new Set();

        for (let attempt = 0; attempt < total; attempt++) {
            const prevId = this.lastUsedAccountId;
            let startIdx = ordered.findIndex(a => a.id > prevId);
            if (startIdx === -1) startIdx = 0;

            let account = null;
            for (let offset = 0; offset < total; offset++) {
                const idx = (startIdx + offset) % total;
                const candidate = ordered[idx];
                const candidateId = candidate?.id;
                if (!candidateId || tried.has(candidateId)) continue;
                if (excludeIds.has(candidateId)) continue;
                account = candidate;
                break;
            }

            if (!account) break;

            const candidateId = account.id;
            tried.add(candidateId);

            // 乐观更新：立即推进 lastUsedAccountId（无 await），避免并发竞争与“跳号导致重复命中”
            this.lastUsedAccountId = candidateId;
            console.log(`[POLL] ts=${Date.now()} prev=${prevId} next=${candidateId} model=${mappedModel}`);

            // 检查账号并发是否已满
            if (!DISABLE_LOCAL_LIMITS && Number.isFinite(MAX_CONCURRENT_PER_ACCOUNT) && MAX_CONCURRENT_PER_ACCOUNT > 0) {
                const lockCount = this.accountLocks.get(account.id) || 0;
                if (lockCount >= MAX_CONCURRENT_PER_ACCOUNT) {
                    continue;
                }
            }

            // 检查是否处于容量冷却期
            if (!DISABLE_LOCAL_LIMITS && mappedModel && this.isAccountInCooldown(account.id, mappedModel)) {
                cooldownCount += 1;
                const until = this.capacityCooldowns.get(`${account.id}:${mappedModel}`);
                if (until && (!earliestCooldownUntil || until < earliestCooldownUntil)) {
                    earliestCooldownUntil = until;
                }
                continue;
            }

            try {
                const validAccount = await ensureValidToken(account);

                // 锁定账号并发
                this.lockAccount(account.id);

                // 更新最后使用时间
                updateAccountLastUsed(account.id);

                return validAccount;
            } catch (err) {
                console.error(`[ACCOUNT_POOL] ensureValidToken failed for account ${account.id} (${account.email}):`, err.message);
                // 继续尝试下一个账号
            }
        }

        // 所有账号都在冷却期：返回 429 + reset after，便于客户端等待后重试
        if (!DISABLE_LOCAL_LIMITS && mappedModel && cooldownCount === total && earliestCooldownUntil) {
            const remainingMs = Math.max(0, earliestCooldownUntil - Date.now());
            const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
            const messageSeconds = Math.max(0, seconds - 1);
            const err = new Error(`No capacity available, reset after ${messageSeconds}s`);
            err.upstreamStatus = 429;
            err.retryAfterMs = remainingMs;
            throw err;
        }

        throw new Error('No available accounts with valid tokens');
    }

    getStrategy() {
        return getPoolStrategy();
    }

    /** sticky 模式下每个额度分组（claude / gemini）当前在用的账号：{ claude: id, gemini: id } */
    getStickyAccounts() {
        const raw = getSetting('stickyAccounts', null);
        return raw && typeof raw === 'object' ? raw : {};
    }

    _setStickyAccount(family, account, mappedModel) {
        const current = this.getStickyAccounts();
        if (Number(current[family]) === account.id) return;
        const prevId = current[family] ?? null;
        setSetting('stickyAccounts', { ...current, [family]: account.id });
        console.log(`[ACCOUNT_POOL] sticky ${family}: ${prevId ?? '-'} -> ${account.id} (${account.email}) model=${mappedModel}`);
    }

    /**
     * sticky 选号：先用该额度分组的「当前号」；它额度用完或失效（已不在可用列表里）时，
     * 按账号 ID 轮到下一个号并把它设为新的当前号。
     * 本次请求临时排除（重试换号）或短暂冷却不会改变当前号，下一次请求仍回到它。
     */
    async _getStickyAccount(accounts, mappedModel, excludeIds) {
        const family = quotaFamily(mappedModel) || mappedModel || 'default';
        const ordered = [...accounts].sort((a, b) => (a.id || 0) - (b.id || 0));
        const total = ordered.length;
        const stickyId = Number(this.getStickyAccounts()[family]) || 0;
        const stickyUsable = ordered.some(a => a.id === stickyId);

        let startIdx = stickyUsable
            ? ordered.findIndex(a => a.id === stickyId)
            : ordered.findIndex(a => a.id > stickyId);
        if (startIdx === -1) startIdx = 0;

        let earliestCooldownUntil = null;
        let cooldownCount = 0;

        for (let offset = 0; offset < total; offset++) {
            const account = ordered[(startIdx + offset) % total];
            if (excludeIds.has(account.id)) continue;

            if (!DISABLE_LOCAL_LIMITS && Number.isFinite(MAX_CONCURRENT_PER_ACCOUNT) && MAX_CONCURRENT_PER_ACCOUNT > 0) {
                const lockCount = this.accountLocks.get(account.id) || 0;
                if (lockCount >= MAX_CONCURRENT_PER_ACCOUNT) continue;
            }

            if (!DISABLE_LOCAL_LIMITS && mappedModel && this.isAccountInCooldown(account.id, mappedModel)) {
                cooldownCount += 1;
                const until = this.capacityCooldowns.get(`${account.id}:${mappedModel}`);
                if (until && (!earliestCooldownUntil || until < earliestCooldownUntil)) {
                    earliestCooldownUntil = until;
                }
                continue;
            }

            try {
                const validAccount = await ensureValidToken(account);
                this.lockAccount(account.id);
                updateAccountLastUsed(account.id);
                this.lastUsedAccountId = account.id;
                if (!stickyUsable) this._setStickyAccount(family, account, mappedModel);
                return validAccount;
            } catch (err) {
                console.error(`[ACCOUNT_POOL] sticky ensureValidToken failed for account ${account.id} (${account.email}):`, err.message);
            }
        }

        if (!DISABLE_LOCAL_LIMITS && mappedModel && cooldownCount === total && earliestCooldownUntil) {
            const remainingMs = Math.max(0, earliestCooldownUntil - Date.now());
            const messageSeconds = Math.max(0, Math.ceil(remainingMs / 1000) - 1);
            const err = new Error(`No capacity available, reset after ${messageSeconds}s`);
            err.upstreamStatus = 429;
            err.retryAfterMs = remainingMs;
            throw err;
        }

        throw new Error('No available accounts with valid tokens');
    }

    /**
     * 优先模式下指定账号额度用完：改为指定当前模型额度最多的另一个可用账号（写回设置，页面同步显示）
     */
    _replacementCandidates(excludeIds, mappedModel) {
        const exclude = new Set([...excludeIds].map(Number));
        // getActiveAccounts(model) 已按该模型剩余额度降序，且排除了额度为 0 的账号
        return getActiveAccounts(mappedModel).filter(a =>
            !exclude.has(a.id) && !(mappedModel && this.isAccountInCooldown(a.id, mappedModel)));
    }

    /**
     * 把指定账号从 fromId 换成 candidate（写回设置，页面轮询设置时同步显示）。
     * 并发请求可能已经替换过，只在当前指定仍是 fromId 时写回。
     */
    _swapPinned(fromId, candidate, mappedModel, reason) {
        const current = getPinnedAccountSetting();
        if (!current || current.id !== fromId || current.strict) return false;
        const from = getAccountById(fromId);
        setSetting('pinnedAccount', {
            id: candidate.id,
            strict: false,
            replacedFrom: { id: fromId, email: from?.email || null },
            replacedReason: reason || null,
            replacedAt: Date.now()
        });
        console.log(`[ACCOUNT_POOL] pinned account ${fromId} (${from?.email}) exhausted for ${mappedModel}, switched to ${candidate.id} (${candidate.email})`);
        return true;
    }

    /**
     * 上游刚报「额度用完」时调用：若该账号正是「优先」模式的指定账号，立即换成额度最多的另一个，
     * 不等下一次请求再来检查。token 有效性留到真正使用时校验（失败时本次请求回退轮询）。
     */
    _swapPinnedOnExhausted(accountId, mappedModel, reason) {
        const pinned = getPinnedAccountSetting();
        if (!pinned || pinned.strict || pinned.id !== accountId) return;
        const [candidate] = this._replacementCandidates([accountId], mappedModel);
        if (!candidate) {
            console.log(`[ACCOUNT_POOL] pinned account ${accountId} exhausted for ${mappedModel}, no replacement available`);
            return;
        }
        this._swapPinned(accountId, candidate, mappedModel, reason);
    }

    /**
     * 兜底：选号时发现指定账号额度为 0（例如由定时配额同步写入），当场换号并返回新账号
     */
    async _replacePinnedAccount(pinned, mappedModel, options, reason) {
        const candidates = this._replacementCandidates([pinned.id, ...(options?.excludeAccountIds || [])], mappedModel);

        for (const candidate of candidates) {
            try {
                const valid = await ensureValidToken(candidate);
                this._swapPinned(pinned.id, candidate, mappedModel, reason);
                this.lockAccount(candidate.id);
                updateAccountLastUsed(candidate.id);
                return valid;
            } catch (err) {
                console.error(`[ACCOUNT_POOL] replace pinned: ensureValidToken failed for ${candidate.id} (${candidate.email}):`, err.message);
            }
        }
        return null;
    }

    /**
     * 取指定账号。
     * 返回 { account } 表示可用；返回 { exhausted, reason } 表示不可用（exhausted=额度用完）。
     * 严格模式下不可用直接抛出原因。
     */
    async _getPinnedAccount(pinned, mappedModel, options) {
        const fail = (reason, extra = {}) => {
            const { exhausted = false, ...errExtra } = extra;
            if (!pinned.strict) return { exhausted, reason };
            const err = new Error(`指定账号不可用：${reason}（可在管理面板取消指定，或改为「优先」模式自动换号）`);
            err.code = 'pinned_account_unavailable';
            Object.assign(err, errExtra);
            throw err;
        };

        const excluded = Array.isArray(options?.excludeAccountIds) && options.excludeAccountIds.map(Number).includes(pinned.id);
        const account = getAccountById(pinned.id);
        if (!account) return fail(`账号 id=${pinned.id} 不存在`);
        const label = `${account.email}（id=${account.id}）`;
        if (account.status !== 'active') return fail(`${label} 状态为 ${account.status}`);

        if (mappedModel) {
            const row = getModelAvailabilityRows(mappedModel).find(r => r.id === account.id);
            if (row && row.quota_remaining !== null && row.quota_remaining <= 0) {
                if (row.quota_reset_time) {
                    const remaining = row.quota_reset_time - Date.now();
                    if (remaining > 0) {
                        return fail(`${label} 的 ${mappedModel} 额度已耗尽，${formatClock(row.quota_reset_time)} 恢复（约 ${formatDuration(remaining)} 后）`,
                            { upstreamStatus: 429, retryAfterMs: remaining, exhausted: true });
                    }
                } else {
                    return fail(`${label} 不支持模型 ${mappedModel}`, { code: 'model_not_available' });
                }
            }
        }

        // 临时冷却（上游短暂容量不足）：本次回退，不替换指定
        if (mappedModel && this.isAccountInCooldown(account.id, mappedModel) && !pinned.strict) {
            return { exhausted: false, reason: `${label} 处于临时冷却` };
        }

        // 同一请求内已用过（重试换号）：严格模式下仍复用同一账号，非严格模式交给轮询
        if (excluded && !pinned.strict) return { exhausted: false, reason: `${label} 本次请求已失败` };

        try {
            const validAccount = await ensureValidToken(account);
            this.lockAccount(account.id);
            updateAccountLastUsed(account.id);
            return { account: validAccount };
        } catch (err) {
            return fail(`${label} token 刷新失败：${err.message}`);
        }
    }

    /**
     * 上游明确返回「个人额度用完 + 重置时间」时：把该账号同一额度分组下的所有模型额度记为 0，
     * 写入重置时间，并在内存冷却到重置时间。之后选号（轮询 / 指定账号）都会直接跳过它，不再先请求一次。
     */
    markQuotaExhausted(accountId, model, resetAt) {
        const models = sameFamilyModels(model);
        for (const m of models) {
            try {
                const row = getModelAvailabilityRows(m).find(r => r.id === accountId);
                // 额度 0 且无重置时间 = 账号不支持该模型，保持原样，避免被误显示成「额度耗尽」
                const unsupported = row && row.quota_remaining !== null && row.quota_remaining <= 0 && !row.quota_reset_time;
                if (!unsupported) upsertAccountModelQuota(accountId, m, 0, resetAt);
            } catch { /* ignore */ }
            if (!DISABLE_LOCAL_LIMITS) this.capacityCooldowns.set(`${accountId}:${m}`, resetAt);
        }
        console.log(`[ACCOUNT_POOL] account ${accountId} quota exhausted for ${models.length} ${quotaFamily(model) || model} model(s), resets at ${formatClock(resetAt)}`);
        this._swapPinnedOnExhausted(accountId, model,
            `${model} 额度已耗尽，${formatClock(resetAt)} 恢复`);
    }

    /**
     * 标记账号出错 - 累计错误，达到阈值才禁用
     * @returns {boolean} 是否已禁用账号
     */
    markAccountError(accountId, error) {
        const threshold = RETRY_CONFIG.errorCountToDisable;
        const current = this.errorCounts.get(accountId) || 0;
        const next = current + 1;

        if (next >= threshold) {
            // 达到阈值，真正禁用
            updateAccountStatus(accountId, 'error', error.message || String(error));
            this.errorCounts.delete(accountId);
            return true;
        } else {
            // 未达阈值，只记录计数
            this.errorCounts.set(accountId, next);
            return false;
        }
    }

    /**
     * 请求成功后重置错误计数
     */
    markAccountSuccess(accountId) {
        this.errorCounts.delete(accountId);
    }

    /**
     * 获取账号当前错误计数
     */
    getErrorCount(accountId) {
        return this.errorCounts.get(accountId) || 0;
    }

    /**
     * 降低账号配额（请求成功后调用）
     */
    decreaseQuota(accountId, amount = 0.001) {
        // 简单的配额估算，实际配额以 API 返回为准
        const accounts = getActiveAccounts();
        const account = accounts.find(a => a.id === accountId);

        if (account) {
            const newQuota = Math.max(0, account.quota_remaining - amount);
            updateAccountQuota(accountId, newQuota, account.quota_reset_time);
        }
    }

    /**
     * 锁定账号（防止并发使用同一账号）
     */
    lockAccount(accountId) {
        if (DISABLE_LOCAL_LIMITS) return;
        if (Number.isFinite(MAX_CONCURRENT_PER_ACCOUNT) && MAX_CONCURRENT_PER_ACCOUNT <= 0) return;
        const current = this.accountLocks.get(accountId) || 0;
        this.accountLocks.set(accountId, current + 1);
    }

    /**
     * 解锁账号
     */
    unlockAccount(accountId) {
        if (DISABLE_LOCAL_LIMITS) return;
        if (Number.isFinite(MAX_CONCURRENT_PER_ACCOUNT) && MAX_CONCURRENT_PER_ACCOUNT <= 0) return;
        const current = this.accountLocks.get(accountId) || 0;
        if (current <= 1) {
            this.accountLocks.delete(accountId);
        } else {
            this.accountLocks.set(accountId, current - 1);
        }
    }

    /**
     * 标记账号在某个模型上容量耗尽，进入短暂冷却期
     */
    markCapacityLimited(accountId, model, message) {
        const mappedModel = model ? getMappedModel(model) : null;
        if (!accountId || !mappedModel) return;

        // 「个人额度用完」（重置时间通常以小时计）：持久化为额度 0，直到重置
        const quotaResetMs = parseQuotaResetMs(message);
        if (quotaResetMs && quotaResetMs > 60 * 1000) {
            this.markQuotaExhausted(accountId, mappedModel, Date.now() + quotaResetMs);
            return quotaResetMs;
        }

        if (DISABLE_LOCAL_LIMITS) return;

        let cooldownMs = CAPACITY_COOLDOWN_DEFAULT_MS;
        const key = `${accountId}:${mappedModel}`;
        const prev = this.capacityErrorCounts.get(key) || 0;
        const next = prev + 1;
        this.capacityErrorCounts.set(key, next);

        // 指数退避：默认冷却 * 2^(n-1)，上限 CAPACITY_COOLDOWN_MAX_MS
        if (CAPACITY_COOLDOWN_DEFAULT_MS > 0) {
            const backoff = CAPACITY_COOLDOWN_DEFAULT_MS * (2 ** Math.max(0, next - 1));
            cooldownMs = Math.min(CAPACITY_COOLDOWN_MAX_MS, backoff);
        }

        // 尝试从错误信息中解析 reset 秒数
        if (typeof message === 'string') {
            const match = message.match(/reset after (\d+)s/i);
            if (match) {
                const seconds = parseInt(match[1], 10);
                if (!Number.isNaN(seconds) && seconds >= 0) {
                    // 稍微多加 1 秒缓冲
                    cooldownMs = (seconds + 1) * 1000;
                }
            }
        }

        const until = Date.now() + cooldownMs;
        this.capacityCooldowns.set(key, until);
        return cooldownMs;
    }

    /**
     * 成功调用后清除该模型的容量错误退避计数
     */
    markCapacityRecovered(accountId, model) {
        if (DISABLE_LOCAL_LIMITS) return;
        const mappedModel = model ? getMappedModel(model) : null;
        if (!accountId || !mappedModel) return;
        const key = `${accountId}:${mappedModel}`;
        this.capacityErrorCounts.delete(key);
    }

    /**
     * 检查账号在某个模型上是否处于冷却期
     */
    isAccountInCooldown(accountId, model) {
        if (DISABLE_LOCAL_LIMITS) return false;
        const mappedModel = model ? getMappedModel(model) : null;
        if (!accountId || !mappedModel) return false;
        const key = `${accountId}:${mappedModel}`;
        const until = this.capacityCooldowns.get(key);
        if (!until) return false;

        if (Date.now() < until) {
            return true;
        }

        // 冷却已过期，清理
        this.capacityCooldowns.delete(key);
        return false;
    }

    /**
     * 获取池状态统计
     */
    getPoolStats() {
        const accounts = getActiveAccounts();

        return {
            total: accounts.length,
            active: accounts.filter(a => a.status === 'active').length,
            avgQuota: accounts.length > 0
                ? accounts.reduce((sum, a) => sum + a.quota_remaining, 0) / accounts.length
                : 0
        };
    }

    /**
     * 获取当前可用账号数量（active 且 quota > 0）
     */
    getAvailableAccountCount(model = null) {
        const mappedModel = model ? getMappedModel(model) : null;
        const accounts = getActiveAccounts(mappedModel);
        return accounts.length;
    }

    /**
     * 刷新所有账号的配额信息
     */
    async refreshAllQuotas() {
        const accounts = getActiveAccounts();

        for (const account of accounts) {
            try {
                if (account.access_token) {
                    await fetchQuotaInfo(account);
                }
            } catch (error) {
                // ignore
            }
        }
    }
}

// 单例
export const accountPool = new AccountPool();
