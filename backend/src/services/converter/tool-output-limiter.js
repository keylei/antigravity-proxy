// Tool result output budget controls (applies only to tool_result forwarded upstream).
// Note: clients often replay tool_result history in full; multiple tool calls can easily exceed context.

// Default (2025-12): disabled (=0) to avoid affecting web scraping, etc.
const TOOL_RESULT_MAX_CHARS = Number(process.env.TOOL_RESULT_MAX_CHARS ?? 0);
const TOOL_RESULT_TOTAL_MAX_CHARS = Number(process.env.TOOL_RESULT_TOTAL_MAX_CHARS ?? 0);
// Keep some tail to preserve hints like "Call fetch with start_index=..."
const TOOL_RESULT_TAIL_CHARS = Number(process.env.TOOL_RESULT_TAIL_CHARS || 1200);

const TOOL_RESULT_TRUNCATE_LOG = !['0', 'false', 'no', 'n', 'off'].includes(
    String(process.env.TOOL_RESULT_TRUNCATE_LOG ?? 'true').trim().toLowerCase()
);

function logToolResultTruncation(payload) {
    if (!TOOL_RESULT_TRUNCATE_LOG) return;
    try {
        const obj = payload && typeof payload === 'object' ? payload : {};
        console.warn(JSON.stringify({ kind: 'tool_result_truncate', ...obj }));
    } catch {
        // ignore
    }
}

export function createToolOutputLimiter(ctx = {}) {
    const total = Number.isFinite(TOOL_RESULT_TOTAL_MAX_CHARS) ? TOOL_RESULT_TOTAL_MAX_CHARS : 0;
    return { remaining: total > 0 ? total : Infinity, ...ctx };
}

function extractTextFromToolJson(parsed) {
    if (Array.isArray(parsed)) {
        const texts = [];
        for (const item of parsed) {
            if (typeof item === 'string') {
                if (item) texts.push(item);
                continue;
            }
            if (item && typeof item === 'object') {
                if (typeof item.text === 'string' && item.text) {
                    texts.push(item.text);
                    continue;
                }
                if (typeof item.content === 'string' && item.content) {
                    texts.push(item.content);
                    continue;
                }
            }
        }
        return texts.length > 0 ? texts.join('\n') : null;
    }

    if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.content)) {
            const parts = [];
            for (const block of parsed.content) {
                if (typeof block === 'string') {
                    if (block) parts.push(block);
                    continue;
                }
                if (block && typeof block === 'object') {
                    if (typeof block.text === 'string' && block.text) {
                        parts.push(block.text);
                        continue;
                    }
                    if (typeof block.content === 'string' && block.content) {
                        parts.push(block.content);
                        continue;
                    }
                }
            }
            if (parts.length > 0) {
                const isErr = parsed.isError ?? parsed.is_error;
                const prefix = isErr ? '[tool_error]\n' : '';
                return prefix + parts.join('\n');
            }
        }

        if (typeof parsed.text === 'string' && parsed.text) return parsed.text;
        if (typeof parsed.output === 'string' && parsed.output) return parsed.output;
        if (typeof parsed.message === 'string' && parsed.message) return parsed.message;
    }

    return null;
}

function normalizeToolOutput(value) {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
            try {
                const parsed = JSON.parse(trimmed);
                const extracted = extractTextFromToolJson(parsed);
                if (typeof extracted === 'string' && extracted) return extracted;
            } catch {
                // ignore
            }
        }
        return value;
    }

    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

export function limitToolOutput(value, limiter = null, meta = {}) {
    const raw = normalizeToolOutput(value);
    const perToolMax = Number.isFinite(TOOL_RESULT_MAX_CHARS) ? TOOL_RESULT_MAX_CHARS : 0;
    const totalRemaining = limiter && typeof limiter.remaining === 'number' ? limiter.remaining : Infinity;

    // disabled: no per-tool cap + no total cap
    if (!(perToolMax > 0) && !Number.isFinite(totalRemaining)) {
        return raw;
    }

    let maxAllowed = Infinity;
    if (perToolMax > 0) maxAllowed = Math.min(maxAllowed, perToolMax);
    if (Number.isFinite(totalRemaining)) maxAllowed = Math.min(maxAllowed, totalRemaining);

    if (!Number.isFinite(maxAllowed)) return raw;

    if (maxAllowed <= 0) {
        const omitted = '[antigravity-proxy] tool output omitted (prompt budget exceeded).';
        if (limiter && Number.isFinite(limiter.remaining)) limiter.remaining = Math.max(0, limiter.remaining - omitted.length);
        logToolResultTruncation({ ...meta, omitted: true, remaining: limiter?.remaining });
        return omitted;
    }

    if (raw.length <= maxAllowed) {
        if (limiter && Number.isFinite(limiter.remaining)) limiter.remaining = Math.max(0, limiter.remaining - raw.length);
        return raw;
    }

    const separator = `\n\n[antigravity-proxy] tool output truncated (${raw.length} -> ${maxAllowed} chars). Showing head+tail.\n\n`;
    let out = '';
    if (separator.length >= maxAllowed) {
        out = separator.slice(0, maxAllowed);
    } else {
        const wantsTail = Number.isFinite(TOOL_RESULT_TAIL_CHARS) && TOOL_RESULT_TAIL_CHARS > 0;
        let tailLen = wantsTail ? Math.min(TOOL_RESULT_TAIL_CHARS, raw.length) : 0;
        // reserve separator + tail
        let headLen = maxAllowed - separator.length - tailLen;
        if (headLen < 0) {
            // fallback: prefer tail to keep start_index hint, head becomes 0
            tailLen = Math.max(0, maxAllowed - separator.length);
            headLen = 0;
        }
        const tail = tailLen > 0 ? raw.slice(Math.max(0, raw.length - tailLen)) : '';
        out = raw.slice(0, headLen) + separator + tail;
    }

    if (limiter && Number.isFinite(limiter.remaining)) limiter.remaining = Math.max(0, limiter.remaining - out.length);
    logToolResultTruncation({ ...meta, truncated: true, before: raw.length, after: out.length, remaining: limiter?.remaining });
    return out;
}

