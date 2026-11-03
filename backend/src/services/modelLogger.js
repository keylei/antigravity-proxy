function parseIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : fallback;
}

const MAX_STRING_CHARS = parseIntEnv('LOG_MAX_CHARS', 20000);

const SENSITIVE_KEYS = new Set([
  'authorization',
  'x_api_key',
  'api_key',
  'apikey',
  'access_token',
  'refresh_token',
  'id_token',
  'client_secret',
  'password',
  'jwt_secret'
]);

function isSensitiveKey(key) {
  const normalized = String(key).trim().toLowerCase().replace(/-/g, '_');
  return SENSITIVE_KEYS.has(normalized);
}

function sanitizeForLog(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    if (MAX_STRING_CHARS > 0 && value.length > MAX_STRING_CHARS) {
      return `${value.slice(0, MAX_STRING_CHARS)}…[truncated ${value.length - MAX_STRING_CHARS} chars]`;
    }
    return value;
  }

  if (typeof value !== 'object') return value;

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map(v => sanitizeForLog(v, seen));
  }

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    // 避免把密钥打到日志里（token 数量/usage 不是密钥，不应被误杀）
    if (isSensitiveKey(k)) {
      out[k] = '[redacted]';
      continue;
    }
    out[k] = sanitizeForLog(v, seen);
  }
  return out;
}

export function logModelCall(payload) {
  // 只输出一条：包含 OpenAI/Anthropic 的完整请求与响应（可能截断超长字符串）
  const safe = sanitizeForLog(payload);
  console.log(JSON.stringify(safe, null, 2));
}
