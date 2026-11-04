// Antigravity OAuth 配置，通过环境变量注入凭据
export const OAUTH_CONFIG = {
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
    token_endpoint: 'https://oauth2.googleapis.com/token',
    auth_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    scope: [
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/cclog',
        'https://www.googleapis.com/auth/experimentsandconfigs'
    ].join(' ')
};

/**
 * 启动前校验 OAuth 客户端凭据。
 * 缺失时所有账号的 token 刷新都会被 Google 以 "Could not determine client ID" 拒绝，
 * 并把账号批量标记为 error，因此直接拒绝启动，避免静默失效。
 */
export function assertOAuthConfig() {
    const missing = [];
    if (!OAUTH_CONFIG.client_id) missing.push('GOOGLE_OAUTH_CLIENT_ID');
    if (!OAUTH_CONFIG.client_secret) missing.push('GOOGLE_OAUTH_CLIENT_SECRET');
    if (missing.length > 0) {
        throw new Error(
            `[Config] 缺少 OAuth 客户端凭据: ${missing.join(', ')}。` +
            '请在 .env（或容器环境变量）中设置后再启动，否则所有账号的 token 刷新都会失败。'
        );
    }
}

// Antigravity API 配置
// 版本号由 versionFetcher 服务动态更新，支持热更新
let _agVersion = '2.25.0'; // 当前上游兼容版本回退值

// 上游按 User-Agent 版本决定可见模型和额度分组：低于 2.25.0 时
// Gemini 3.8 Flash 与 Gemini 额度分组都不返回（2026-11-03 实测），因此版本号不得低于该值
const MIN_AG_VERSION = '2.25.0';

function compareVersions(a, b) {
    const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d !== 0) return d;
    }
    return 0;
}

export function setAgVersion(version) {
    if (version && typeof version === 'string' && /^\d+\.\d+\.\d+/.test(version)) {
        _agVersion = compareVersions(version, MIN_AG_VERSION) >= 0 ? version : MIN_AG_VERSION;
    }
}

export function getAgVersion() {
    return _agVersion;
}

export const ANTIGRAVITY_CONFIG = {
    base_url: 'https://daily-cloudcode-pa.googleapis.com',
    get user_agent() {
        return `antigravity/${_agVersion} windows/amd64`;
    }
};

// Unleash 功能开关 Token
export const UNLEASH_TOKENS = {
    frontend: 'production.eb07600f9680e825c582db6570e7e0adf500657b3dc4802625ba4516',
    client: 'production.e44558998bfc35ea9584dc65858e4485fdaa5d7ef46903e0c67712d1'
};

// Antigravity 官方系统提示词（上游可能会校验；可用 OFFICIAL_SYSTEM_PROMPT 覆盖）
export const DEFAULT_OFFICIAL_SYSTEM_PROMPT =
    'You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding.' +
    'You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.' +
    '**Proactiveness**';

// 使用 getter 延迟读取，确保 .env 加载后再获取值
export const OFFICIAL_SYSTEM_PROMPT_CONFIG = Object.freeze({
    get value() {
        return String(process.env.OFFICIAL_SYSTEM_PROMPT || DEFAULT_OFFICIAL_SYSTEM_PROMPT);
    }
});

// 兼容：直接导出（运行时读取）
export function getOfficialSystemPrompt() {
    return OFFICIAL_SYSTEM_PROMPT_CONFIG.value;
}

// 服务器配置（使用 getter 延迟读取，确保 .env 加载后再获取值）
export const SERVER_CONFIG = Object.freeze({
    get port() {
        return process.env.PORT || 8088;
    },
    get host() {
        return process.env.HOST || '127.0.0.1';
    },
    get db_path() {
        return process.env.DB_PATH || './data/database.sqlite';
    },
    get admin_password() {
        return process.env.ADMIN_PASSWORD || 'admin123';
    },
    // 管理接口兼容：Authorization: Bearer <ADMIN_PASSWORD>
    // 默认开启；可通过环境变量关闭（0/false/no/off）
    get admin_password_bearer_compat() {
        return parseBoolean(process.env.ADMIN_PASSWORD_BEARER_COMPAT, true);
    }
});

function parseBoolean(value, defaultValue) {
    if (value === undefined || value === null || value === '') return defaultValue;
    const v = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
    return defaultValue;
}

// 可用模型列表
export const AVAILABLE_MODELS = [
    // Gemini 3.8 Flash：上游按 tier 区分档位；User-Agent 版本需 >= 2.25.0 才会返回（见 MIN_AG_VERSION）
    // maxTokens / maxOutputTokens 取自上游 fetchAvailableModels（2026-11-04）
    { id: 'gemini-3.8-flash-high', displayName: 'Gemini 3.8 Flash (High)', provider: 'google', supportsImages: true, supportsThinking: true, maxTokens: 1048576, maxOutputTokens: 65536 },
    { id: 'gemini-3.8-flash-medium', displayName: 'Gemini 3.8 Flash (Medium)', provider: 'google', supportsImages: true, supportsThinking: true, maxTokens: 1048576, maxOutputTokens: 65536 },
    { id: 'gemini-3.8-flash-low', displayName: 'Gemini 3.8 Flash (Low)', provider: 'google', supportsImages: true, supportsThinking: true, maxTokens: 1048576, maxOutputTokens: 65536 },
    { id: 'gemini-3-flash', displayName: 'Gemini 3 Flash', provider: 'google', supportsImages: true, supportsThinking: true, maxTokens: 1048576, maxOutputTokens: 65536 },
    // 兼容：通过模型名显式启用 thinking（映射到 gemini-3-flash）
    { id: 'gemini-3-flash-thinking', displayName: 'Gemini 3 Flash (Thinking)', provider: 'google', supportsImages: true, supportsThinking: true, maxTokens: 1048576, maxOutputTokens: 65536 },
    { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', provider: 'google', supportsImages: true, supportsThinking: true, maxTokens: 1048576, maxOutputTokens: 65535 },
    { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', provider: 'google', supportsImages: true, supportsThinking: true, maxTokens: 1048576, maxOutputTokens: 65535 },
    { id: 'gemini-2.5-flash-thinking', displayName: 'Gemini 2.5 Flash (Thinking)', provider: 'google', supportsImages: true, supportsThinking: true, maxTokens: 1048576, maxOutputTokens: 65535 },
    { id: 'gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash Lite', provider: 'google', supportsImages: false, supportsThinking: false, maxTokens: 1048576, maxOutputTokens: 65535 },
    { id: 'gemini-3.1-pro-high', displayName: 'Gemini 3.1 Pro (High)', provider: 'google', supportsImages: true, supportsThinking: true, maxTokens: 1048576, maxOutputTokens: 65535 },
    { id: 'gemini-3.1-pro-low', displayName: 'Gemini 3.1 Pro (Low)', provider: 'google', supportsImages: true, supportsThinking: true, maxTokens: 1048576, maxOutputTokens: 65535 },
    { id: 'gemini-3.1-flash-image', displayName: 'Gemini 3.1 Flash Image', provider: 'google', supportsImages: true, supportsThinking: true },
    { id: 'claude-opus-4-6', displayName: 'Claude Opus 4.6', provider: 'anthropic', supportsImages: true, supportsThinking: false, maxTokens: 200000, maxOutputTokens: 64000 },
    { id: 'claude-opus-4-6-thinking', displayName: 'Claude Opus 4.6 (Thinking)', provider: 'anthropic', supportsImages: true, supportsThinking: true, maxTokens: 200000, maxOutputTokens: 64000 },
    { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', provider: 'anthropic', supportsImages: true, supportsThinking: false, maxTokens: 200000, maxOutputTokens: 64000 },
    { id: 'claude-sonnet-4-6-thinking', displayName: 'Claude Sonnet 4.6 (Thinking)', provider: 'anthropic', supportsImages: true, supportsThinking: true, maxTokens: 200000, maxOutputTokens: 64000 },
    // Claude 5.5: upstream only accepts tier-suffixed IDs; bare claude-opus-5-5 / claude-opus-5.5 return 404.
    // maxTokens / maxOutputTokens as reported by upstream fetchAvailableModels (2026-11-03).
    { id: 'claude-opus-5-5-high', displayName: 'Claude Opus 5.5 (High)', provider: 'anthropic', supportsImages: true, supportsThinking: true, maxTokens: 1000000, maxOutputTokens: 128000 },
    { id: 'claude-opus-5-5-medium', displayName: 'Claude Opus 5.5 (Medium)', provider: 'anthropic', supportsImages: true, supportsThinking: true, maxTokens: 1000000, maxOutputTokens: 128000 },
    { id: 'claude-opus-5-5-low', displayName: 'Claude Opus 5.5 (Low)', provider: 'anthropic', supportsImages: true, supportsThinking: true, maxTokens: 1000000, maxOutputTokens: 128000 },
    { id: 'claude-sonnet-5-5-high', displayName: 'Claude Sonnet 5.5 (High)', provider: 'anthropic', supportsImages: true, supportsThinking: true, maxTokens: 1000000, maxOutputTokens: 128000 },
    { id: 'claude-sonnet-5-5-medium', displayName: 'Claude Sonnet 5.5 (Medium)', provider: 'anthropic', supportsImages: true, supportsThinking: true, maxTokens: 1000000, maxOutputTokens: 128000 },
    { id: 'claude-sonnet-5-5-low', displayName: 'Claude Sonnet 5.5 (Low)', provider: 'anthropic', supportsImages: true, supportsThinking: true, maxTokens: 1000000, maxOutputTokens: 128000 },
];

// Explicit aliases let OpenAI-compatible clients select these models without thinking.
for (const model of AVAILABLE_MODELS.filter(model => /^claude-(opus|sonnet)-5-5-(high|medium|low)$/.test(model.id))) {
    AVAILABLE_MODELS.push({
        ...model,
        id: `${model.id}-no-thinking`,
        displayName: `${model.displayName} (No Thinking)`,
        supportsThinking: false
    });
}

// 模型名称映射（用户请求的模型 -> 实际发送的模型）
export const MODEL_MAPPING = {
    'claude-opus-4-6': 'claude-opus-4-6-thinking',
    'claude-4-6-thinking': 'claude-opus-4-6-thinking',
    'claude-4-6': 'claude-opus-4-6-thinking',
    'claude-sonnet-4-6-thinking': 'claude-sonnet-4-6',
    // 废弃模型兼容映射
    'claude-opus-4-5': 'claude-opus-4-6-thinking',
    'claude-opus-4-5-thinking': 'claude-opus-4-6-thinking',
    'claude-4-5-thinking': 'claude-opus-4-6-thinking',
    'claude-4-5': 'claude-opus-4-6-thinking',
    'claude-sonnet-4-5': 'claude-sonnet-4-6',
    'claude-sonnet-4-5-thinking': 'claude-sonnet-4-6',
    // Claude Haiku 不存在，映射到 Opus 4.6
    'claude-haiku-4-5-20251001': 'claude-opus-4-6',
    'gemini-2.5-flash-thinking': 'gemini-2.5-flash',
    'gemini-3-flash-thinking': 'gemini-3-flash',
    // 兼容旧版模型名称
    'gemini-2.0-flash': 'gemini-2.5-flash',
    'gemini-2.0-flash-thinking': 'gemini-2.5-flash',
    'gemini-2.0-pro': 'gemini-2.5-pro',
    'gemini-1.5-flash': 'gemini-2.5-flash',
    'gemini-1.5-pro': 'gemini-2.5-pro',
    'gemini-flash': 'gemini-2.5-flash',
    'gemini-pro': 'gemini-2.5-pro'
};

// 默认启用思维链的模型
export const THINKING_MODELS = [
    'gemini-2.5-pro',
    'gemini-2.5-flash-thinking',
    'gemini-3-flash-thinking',
    'gemini-3.1-pro-high',
    'gemini-3.1-pro-low',
    'gemini-3.1-flash-image',
    'claude-opus-4-6-thinking',
    'claude-sonnet-4-6-thinking'
];

// Claude 5.5 encodes the reasoning tier in the model ID
// (e.g. claude-opus-5-5-high), so every tier is a thinking model.
// Gemini 3.8 Flash 同样以档位后缀区分推理强度，也按思维链模型处理
const CLAUDE_TIERED_THINKING_PATTERN = /^(claude-(opus|sonnet)-5-5|gemini-3\.8-flash)-(high|medium|low)$/;

// 判断模型是否启用思维链
export function isThinkingModel(model) {
    const m = String(model || '');
    if (m.endsWith('-no-thinking')) return false;
    return THINKING_MODELS.includes(m) ||
        m.endsWith('-thinking') ||
        CLAUDE_TIERED_THINKING_PATTERN.test(m);
}

// 判断模型是否是图像生成模型（不支持系统提示词，但支持思维链）
export function isImageGenerationModel(model) {
    const m = String(model || '');
    return m === 'gemini-3.1-flash-image' || m.includes('-image');
}

// 获取实际发送的模型名称
// `-no-thinking` 只是本地别名（关闭思维链），上游没有这个模型 ID，
// 账号选择 / 配额判断必须按去掉后缀的真实模型来查，否则会误判为「没有账号支持该模型」
export function getMappedModel(model) {
    const base = String(model || '').replace(/-no-thinking$/, '');
    return MODEL_MAPPING[base] || base;
}

// Safety settings：完整版（11 类）和基础版（5 类）
const FULL_SAFETY_SETTINGS = [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_UNSPECIFIED', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_IMAGE_HATE', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_IMAGE_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_IMAGE_HARASSMENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_IMAGE_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_JAILBREAK', threshold: 'BLOCK_NONE' }
];

const BASIC_SAFETY_SETTINGS = FULL_SAFETY_SETTINGS.slice(0, 4);

const BASIC_SAFETY_MODELS = new Set(['gemini-2.5-flash-lite']);

export function getSafetySettings(model) {
    if (!model || model.startsWith('claude-') || model.startsWith('gpt-')) return undefined;
    return BASIC_SAFETY_MODELS.has(model) ? BASIC_SAFETY_SETTINGS : FULL_SAFETY_SETTINGS;
}

// ========= 集中配置（供 routes / converter 共用） =========

// 注意：部分配置此前是在请求处理时读取 env（支持运行期调整）。
// 为保持行为一致，这里使用 getter 读取 process.env。
export const RETRY_CONFIG = Object.freeze({
    // countTokens 请求的切号重试次数（硬编码，无需配置）
    maxRetries: 2,
    get baseRetryDelayMs() {
        return Math.max(0, Number(process.env.UPSTREAM_CAPACITY_RETRY_DELAY_MS || 1000));
    },
    // 同号重试次数（在换号前先重试几次）
    get sameAccountRetries() {
        return Math.max(0, Number(process.env.SAME_ACCOUNT_RETRIES || 2));
    },
    // 同号重试延迟 (ms)
    get sameAccountRetryDelayMs() {
        return Math.max(0, Number(process.env.SAME_ACCOUNT_RETRY_DELAY_MS || 500));
    },
    // 连续失败多少次才禁用账号
    get errorCountToDisable() {
        return Math.max(1, Number(process.env.ERROR_COUNT_TO_DISABLE || 3));
    },
    // 重试总超时时间 (ms)，默认 30 秒，避免客户端长时间等待
    get totalTimeoutMs() {
        return Math.max(0, Number(process.env.RETRY_TOTAL_TIMEOUT_MS || 30000));
    }
});

export const CONVERTER_CONFIG = Object.freeze({
    DEFAULT_THINKING_BUDGET: 4096,
    DEFAULT_TEMPERATURE: 1,
    // tool_result budget controls (applies only to tool_result forwarded upstream)
    get TOOL_RESULT_MAX_CHARS() {
        return Number(process.env.TOOL_RESULT_MAX_CHARS ?? 0);
    },
    get TOOL_RESULT_TOTAL_MAX_CHARS() {
        return Number(process.env.TOOL_RESULT_TOTAL_MAX_CHARS ?? 0);
    },
    get TOOL_RESULT_TAIL_CHARS() {
        return Number(process.env.TOOL_RESULT_TAIL_CHARS || 1200);
    },
    get TOOL_RESULT_TRUNCATE_LOG() {
        return parseBoolean(process.env.TOOL_RESULT_TRUNCATE_LOG, true);
    },
    // cap max_tokens when request contains tools/tool_results
    get MAX_OUTPUT_TOKENS_WITH_TOOLS() {
        return Number(process.env.MAX_OUTPUT_TOKENS_WITH_TOOLS ?? 0);
    }
});

export const SIGNATURE_CACHE_CONFIG = Object.freeze({
    // Anthropic thinking.signature cache TTL (ms)
    get CLAUDE_THINKING_SIGNATURE_TTL_MS() {
        return Number(process.env.CLAUDE_THINKING_SIGNATURE_TTL_MS || 24 * 60 * 60 * 1000);
    },
    // userKey -> last signature TTL (ms)
    get CLAUDE_LAST_SIGNATURE_TTL_MS() {
        return Number(process.env.CLAUDE_LAST_SIGNATURE_TTL_MS || 24 * 60 * 60 * 1000);
    }
});
