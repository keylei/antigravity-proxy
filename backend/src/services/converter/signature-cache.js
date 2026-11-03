import { createHash } from 'crypto';

import { getDatabase } from '../../db/index.js';

export function logThinkingDowngrade(payload) {
    try {
        const obj = payload && typeof payload === 'object' ? payload : {};
        console.warn(JSON.stringify({ kind: 'thinking_downgrade', ...obj }));
    } catch {
        // ignore
    }
}

// Gemini tool calling: cache thoughtSignature (OpenAI clients do not have this field)
const TOOL_THOUGHT_SIGNATURE_TTL_MS = Number(process.env.TOOL_THOUGHT_SIGNATURE_TTL_MS || 10 * 60 * 1000);
const TOOL_THOUGHT_SIGNATURE_MAX = Number(process.env.TOOL_THOUGHT_SIGNATURE_MAX || 5000);
const toolThoughtSignatureCache = new Map(); // tool_call_id -> { signature, savedAt }

// Special marker: upstream returned tool_use without any thinking/signature for that tool_use_id.
// Used to prevent lastSig fallback from replaying an unrelated signature into a message that never had thinking.
export const CLAUDE_THINKING_SIGNATURE_NO_THINKING_MARKER = '__NO_THINKING__';

// Claude extended thinking: signature replay/cache (Anthropic endpoint)
const CLAUDE_THINKING_SIGNATURE_TTL_MS = Number(process.env.CLAUDE_THINKING_SIGNATURE_TTL_MS || 24 * 60 * 60 * 1000);
const CLAUDE_THINKING_SIGNATURE_MAX = Number(process.env.CLAUDE_THINKING_SIGNATURE_MAX || 5000);
const claudeThinkingSignatureCache = new Map(); // tool_use_id -> { signature, savedAt }

// Claude extended thinking: userKey -> last signature fallback
const CLAUDE_LAST_SIGNATURE_TTL_MS = Number(process.env.CLAUDE_LAST_SIGNATURE_TTL_MS || 24 * 60 * 60 * 1000);
const CLAUDE_LAST_SIGNATURE_MAX = Number(process.env.CLAUDE_LAST_SIGNATURE_MAX || 50000);
const claudeLastThinkingSignatureCache = new Map(); // userKey -> { signature, savedAt }

const SIGNATURE_CACHE_KIND_CLAUDE_THINKING = 'claude_thinking_signature';
const SIGNATURE_CACHE_KIND_CLAUDE_LAST_THINKING = 'claude_last_thinking_signature';
let signatureCacheGetStmt = null;
let signatureCacheUpsertStmt = null;
let signatureCacheDeleteStmt = null;
let signatureCacheCleanupStmt = null;
let lastSignatureCacheCleanupAt = 0;

function ensureSignatureCacheStatements() {
    if (signatureCacheGetStmt && signatureCacheUpsertStmt && signatureCacheDeleteStmt && signatureCacheCleanupStmt) return;
    try {
        const db = getDatabase();
        signatureCacheGetStmt = db.prepare(
            'SELECT signature, saved_at FROM signature_cache WHERE kind = ? AND cache_key = ?'
        );
        signatureCacheUpsertStmt = db.prepare(
            'INSERT INTO signature_cache (kind, cache_key, signature, saved_at) VALUES (?, ?, ?, ?) ' +
            'ON CONFLICT(kind, cache_key) DO UPDATE SET signature = excluded.signature, saved_at = excluded.saved_at'
        );
        signatureCacheDeleteStmt = db.prepare(
            'DELETE FROM signature_cache WHERE kind = ? AND cache_key = ?'
        );
        signatureCacheCleanupStmt = db.prepare(
            'DELETE FROM signature_cache WHERE kind = ? AND saved_at < ?'
        );
    } catch {
        // db not initialized / table not ready
    }
}

function upsertSignatureCache(kind, cacheKey, signature, savedAt) {
    if (!kind || !cacheKey || !signature || !savedAt) return;
    try {
        ensureSignatureCacheStatements();
        if (!signatureCacheUpsertStmt) return;
        signatureCacheUpsertStmt.run(kind, cacheKey, signature, savedAt);
    } catch {
        // ignore
    }
}

function getSignatureCache(kind, cacheKey) {
    try {
        ensureSignatureCacheStatements();
        if (!signatureCacheGetStmt) return null;
        return signatureCacheGetStmt.get(kind, cacheKey) || null;
    } catch {
        return null;
    }
}

function deleteSignatureCache(kind, cacheKey) {
    try {
        ensureSignatureCacheStatements();
        if (!signatureCacheDeleteStmt) return;
        signatureCacheDeleteStmt.run(kind, cacheKey);
    } catch {
        // ignore
    }
}

function maybeCleanupSignatureCache(kind, ttlMs) {
    if (!kind) return;
    if (!ttlMs || ttlMs <= 0) return;
    const now = Date.now();
    // at most once per 5 minutes to avoid frequent DB writes
    if (now - lastSignatureCacheCleanupAt < 5 * 60 * 1000) return;
    try {
        ensureSignatureCacheStatements();
        if (!signatureCacheCleanupStmt) return;
        signatureCacheCleanupStmt.run(kind, now - ttlMs);
        lastSignatureCacheCleanupAt = now;
    } catch {
        // ignore
    }
}

// OpenAI endpoint: Claude tools + thinking replay
const claudeToolThinkingCache = new Map(); // tool_call_id -> { signature, thoughtText, savedAt }

// Claude assistant signature replay cache (for clients that don't replay thinking blocks)
const CLAUDE_ASSISTANT_SIGNATURE_TTL_MS = Number(process.env.CLAUDE_ASSISTANT_SIGNATURE_TTL_MS || 6 * 60 * 60 * 1000);
const CLAUDE_ASSISTANT_SIGNATURE_MAX = Number(process.env.CLAUDE_ASSISTANT_SIGNATURE_MAX || 10000);
const claudeAssistantSignatureCache = new Map(); // `${userKey}|${hash}` -> { signature, savedAt }

function stableStringify(value) {
    if (value === null || value === undefined) return String(value);
    if (typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    const keys = Object.keys(value).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

function hashForAssistantSignatureReplay(content) {
    const normalized = stableStringify(content);
    return createHash('sha256').update(normalized).digest('hex');
}

export function cacheClaudeAssistantSignature(userKey, assistantContentWithoutThinking, signature) {
    if (!userKey || !signature) return;
    const hash = hashForAssistantSignatureReplay(assistantContentWithoutThinking);
    const key = `${String(userKey)}|${hash}`;
    claudeAssistantSignatureCache.set(key, { signature: String(signature), savedAt: Date.now() });
    if (CLAUDE_ASSISTANT_SIGNATURE_MAX > 0 && claudeAssistantSignatureCache.size > CLAUDE_ASSISTANT_SIGNATURE_MAX) {
        const oldestKey = claudeAssistantSignatureCache.keys().next().value;
        if (oldestKey) claudeAssistantSignatureCache.delete(oldestKey);
    }
}

export function getCachedClaudeAssistantSignature(userKey, assistantContentWithoutThinking) {
    if (!userKey) return null;
    const hash = hashForAssistantSignatureReplay(assistantContentWithoutThinking);
    const key = `${String(userKey)}|${hash}`;
    const entry = claudeAssistantSignatureCache.get(key);
    if (!entry) return null;
    if (CLAUDE_ASSISTANT_SIGNATURE_TTL_MS > 0 && Date.now() - entry.savedAt > CLAUDE_ASSISTANT_SIGNATURE_TTL_MS) {
        claudeAssistantSignatureCache.delete(key);
        return null;
    }
    return entry.signature;
}

export function cacheToolThoughtSignature(toolCallId, signature) {
    if (!toolCallId || !signature) return;
    const key = String(toolCallId);
    toolThoughtSignatureCache.set(key, { signature: String(signature), savedAt: Date.now() });

    // Avoid unlimited growth (evict oldest)
    if (TOOL_THOUGHT_SIGNATURE_MAX > 0 && toolThoughtSignatureCache.size > TOOL_THOUGHT_SIGNATURE_MAX) {
        const oldestKey = toolThoughtSignatureCache.keys().next().value;
        if (oldestKey) toolThoughtSignatureCache.delete(oldestKey);
    }
}

export function getCachedToolThoughtSignature(toolCallId) {
    if (!toolCallId) return null;
    const key = String(toolCallId);
    const entry = toolThoughtSignatureCache.get(key);
    if (!entry) return null;
    if (TOOL_THOUGHT_SIGNATURE_TTL_MS > 0 && Date.now() - entry.savedAt > TOOL_THOUGHT_SIGNATURE_TTL_MS) {
        toolThoughtSignatureCache.delete(key);
        return null;
    }
    return entry.signature;
}

export function cacheClaudeThinkingSignature(toolUseId, signature) {
    if (!toolUseId || !signature) return;
    const key = String(toolUseId);
    const savedAt = Date.now();
    const sig = String(signature);
    claudeThinkingSignatureCache.set(key, { signature: sig, savedAt });
    // persist to survive container restarts
    upsertSignatureCache(SIGNATURE_CACHE_KIND_CLAUDE_THINKING, key, sig, savedAt);
    maybeCleanupSignatureCache(SIGNATURE_CACHE_KIND_CLAUDE_THINKING, CLAUDE_THINKING_SIGNATURE_TTL_MS);

    if (CLAUDE_THINKING_SIGNATURE_MAX > 0 && claudeThinkingSignatureCache.size > CLAUDE_THINKING_SIGNATURE_MAX) {
        const oldestKey = claudeThinkingSignatureCache.keys().next().value;
        if (oldestKey) claudeThinkingSignatureCache.delete(oldestKey);
    }
}

export function cacheClaudeLastThinkingSignature(userKey, signature) {
    if (!userKey || !signature) return;
    const key = String(userKey);
    const savedAt = Date.now();
    const sig = String(signature);
    claudeLastThinkingSignatureCache.set(key, { signature: sig, savedAt });
    upsertSignatureCache(SIGNATURE_CACHE_KIND_CLAUDE_LAST_THINKING, key, sig, savedAt);
    maybeCleanupSignatureCache(SIGNATURE_CACHE_KIND_CLAUDE_LAST_THINKING, CLAUDE_LAST_SIGNATURE_TTL_MS);

    if (CLAUDE_LAST_SIGNATURE_MAX > 0 && claudeLastThinkingSignatureCache.size > CLAUDE_LAST_SIGNATURE_MAX) {
        const oldestKey = claudeLastThinkingSignatureCache.keys().next().value;
        if (oldestKey) claudeLastThinkingSignatureCache.delete(oldestKey);
    }
}

export function getCachedClaudeLastThinkingSignature(userKey) {
    if (!userKey) return null;
    const key = String(userKey);
    const now = Date.now();
    const entry = claudeLastThinkingSignatureCache.get(key);
    if (entry) {
        if (CLAUDE_LAST_SIGNATURE_TTL_MS > 0 && now - entry.savedAt > CLAUDE_LAST_SIGNATURE_TTL_MS) {
            claudeLastThinkingSignatureCache.delete(key);
        } else {
            return entry.signature;
        }
    }

    const row = getSignatureCache(SIGNATURE_CACHE_KIND_CLAUDE_LAST_THINKING, key);
    if (!row) return null;
    const savedAt = Number(row.saved_at) || 0;
    if (CLAUDE_LAST_SIGNATURE_TTL_MS > 0 && savedAt > 0 && now - savedAt > CLAUDE_LAST_SIGNATURE_TTL_MS) {
        deleteSignatureCache(SIGNATURE_CACHE_KIND_CLAUDE_LAST_THINKING, key);
        return null;
    }
    const sig = row.signature ? String(row.signature) : '';
    if (!sig) return null;
    claudeLastThinkingSignatureCache.set(key, { signature: sig, savedAt: savedAt || now });
    return sig;
}

export function getCachedClaudeThinkingSignature(toolUseId) {
    if (!toolUseId) return null;
    const key = String(toolUseId);
    const now = Date.now();
    const entry = claudeThinkingSignatureCache.get(key);
    if (entry) {
        if (CLAUDE_THINKING_SIGNATURE_TTL_MS > 0 && now - entry.savedAt > CLAUDE_THINKING_SIGNATURE_TTL_MS) {
            claudeThinkingSignatureCache.delete(key);
        } else {
            return entry.signature;
        }
    }

    const row = getSignatureCache(SIGNATURE_CACHE_KIND_CLAUDE_THINKING, key);
    if (!row) return null;
    const savedAt = Number(row.saved_at) || 0;
    if (CLAUDE_THINKING_SIGNATURE_TTL_MS > 0 && savedAt > 0 && now - savedAt > CLAUDE_THINKING_SIGNATURE_TTL_MS) {
        deleteSignatureCache(SIGNATURE_CACHE_KIND_CLAUDE_THINKING, key);
        return null;
    }
    const sig = row.signature ? String(row.signature) : '';
    if (!sig) return null;
    claudeThinkingSignatureCache.set(key, { signature: sig, savedAt: savedAt || now });
    return sig;
}

export function cacheClaudeToolThinking(toolCallId, signature, thoughtText) {
    if (!toolCallId || !signature) return;
    const key = String(toolCallId);
    claudeToolThinkingCache.set(key, {
        signature: String(signature),
        thoughtText: String(thoughtText || ''),
        savedAt: Date.now()
    });
    // cross-endpoint/restart compatibility: persist as common signature_cache
    cacheClaudeThinkingSignature(key, String(signature));
    if (CLAUDE_THINKING_SIGNATURE_MAX > 0 && claudeToolThinkingCache.size > CLAUDE_THINKING_SIGNATURE_MAX) {
        const oldestKey = claudeToolThinkingCache.keys().next().value;
        if (oldestKey) claudeToolThinkingCache.delete(oldestKey);
    }
}

export function getCachedClaudeToolThinking(toolCallId) {
    if (!toolCallId) return null;
    const key = String(toolCallId);
    const entry = claudeToolThinkingCache.get(key);
    if (!entry) {
        // If signature was written from Anthropic endpoint, try recover from signature_cache
        const recovered = getCachedClaudeThinkingSignature(key);
        if (recovered && recovered !== CLAUDE_THINKING_SIGNATURE_NO_THINKING_MARKER) {
            cacheClaudeToolThinking(key, recovered, '');
            return claudeToolThinkingCache.get(key) || null;
        }
        return null;
    }
    if (CLAUDE_THINKING_SIGNATURE_TTL_MS > 0 && Date.now() - entry.savedAt > CLAUDE_THINKING_SIGNATURE_TTL_MS) {
        claudeToolThinkingCache.delete(key);
        return null;
    }
    return entry;
}

