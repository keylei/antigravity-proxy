/**
 * Convert OpenAI/Gemini tool schema and media into Antigravity/Gemini-compatible shapes.
 */

export function convertTool(tool) {
    const func = tool.function || tool;

    return {
        name: func.name,
        description: func.description || '',
        parameters: convertJsonSchema(func.parameters)
    };
}

/**
 * Claude 和 Gemini API 共同支持的 JSON Schema 字段白名单（取交集）
 *
 * 注意：Gemini 的 functionDeclarations.parameters 使用的是 OpenAPI 3.0 Schema 子集，
 *       不是完整的 JSON Schema。官方文档: https://ai.google.dev/api/caching#Schema
 *
 * Gemini Schema 支持的字段:
 *   type, format, title, description, nullable, enum, maxItems, minItems,
 *   properties, required, minProperties, maxProperties, minLength, maxLength,
 *   pattern, example, anyOf, propertyOrdering, default, items, minimum, maximum
 *
 * Claude 支持的字段:
 *   type, properties, required, items, enum, description, const, default,
 *   anyOf, allOf, $ref, $defs, definitions, additionalProperties, minItems, format
 *
 * 交集（两者都支持）:
 *   type, properties, required, items, enum, description, anyOf, minItems, format, default
 *
 * 注意事项:
 * - Gemini 不支持: $ref, $defs, allOf, additionalProperties, const
 * - Claude 不支持: title, nullable, maxItems, minProperties, maxProperties,
 *                  minLength, maxLength, pattern, example, propertyOrdering, minimum, maximum
 */
const ALLOWED_SCHEMA_FIELDS = new Set([
    'type',
    'properties',
    'required',
    'items',
    'enum',
    'description',
    'anyOf',
    'minItems',      // Claude 仅支持 0 和 1
    'format',        // Claude 仅支持特定格式
    'default'        // 两者都支持
]);

/**
 * Anthropic 支持的字符串格式
 */
const SUPPORTED_STRING_FORMATS = new Set([
    'date-time', 'time', 'date', 'duration',
    'email', 'hostname', 'uri',
    'ipv4', 'ipv6', 'uuid'
]);

/**
 * 危险的对象 key，可能导致原型污染
 */
const DANGEROUS_KEYS = new Set([
    '__proto__',
    'constructor',
    'prototype'
]);

/**
 * 最大递归深度，防止 DoS 攻击
 */
const MAX_RECURSION_DEPTH = 20;

function scoreSchemaForAnyOfSelection(schema) {
    if (!schema || typeof schema !== 'object') return -Infinity;
    const type = typeof schema.type === 'string' ? schema.type.toLowerCase() : '';
    let score = 0;

    // Prefer structured schemas: object/array > primitives
    if (type === 'object') score += 100;
    else if (type === 'array') score += 80;
    else if (type) score += 10;

    if (schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)) {
        score += 20;
        try {
            score += Math.min(10, Object.keys(schema.properties).length);
        } catch {
            // ignore
        }
    }
    if (schema.items) score += 10;
    if (schema.enum) score += 5;
    if (schema.format) score += 2;
    if (Array.isArray(schema.required) && schema.required.length > 0) score += 1;

    return score;
}

function pickBestAnyOfCandidate(candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) return undefined;
    let best = undefined;
    let bestScore = -Infinity;
    for (const c of candidates) {
        const s = scoreSchemaForAnyOfSelection(c);
        if (s > bestScore) {
            bestScore = s;
            best = c;
        }
    }
    return best;
}

/**
 * Convert JSON Schema (remove unsupported fields; optionally uppercase types).
 *
 * 本函数将 JSON Schema 转换为 Claude 和 Gemini API 共同支持的格式（取交集）。
 *
 * 共同支持的字段:
 *   type, properties, required, items, enum, description, anyOf, minItems, format, default
 *
 * 不支持的字段（会被删除）:
 *   - Gemini 不支持: $ref, $defs, allOf, additionalProperties, const
 *   - Claude 不支持: title, nullable, maxItems, pattern, minimum, maximum 等
 *   - 两者都不支持: $schema, if/then/else, not, dependencies 等
 *
 * 注意: Gemini 要求 type 必须是大写字符串 (如 "STRING", "OBJECT")
 *
 * @param {Object} schema JSON Schema
 * @param {boolean} uppercaseTypes Gemini expects uppercase; Claude expects lowercase.
 * @param {number} depth 当前递归深度（内部使用，防止 DoS）
 */
export function convertJsonSchema(schema, uppercaseTypes = true, depth = 0) {
    // 防止 DoS：限制递归深度
    if (depth > MAX_RECURSION_DEPTH) {
        return undefined;
    }

    if (!schema || typeof schema !== 'object') return undefined;

    // 上游只接受单个 schema 对象；若遇到数组形式，取第一个可转换的 schema
    if (Array.isArray(schema)) {
        for (const s of schema) {
            const c = convertJsonSchema(s, uppercaseTypes, depth + 1);
            if (c) return c;
        }
        return undefined;
    }

    // 使用 Object.create(null) 防止原型污染
    const converted = Object.create(null);

    // 只复制白名单中的字段
    for (const field of ALLOWED_SCHEMA_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(schema, field) && schema[field] !== undefined) {
            converted[field] = schema[field];
        }
    }

    // 处理 type 字段
    if (converted.type !== undefined) {
        let t = converted.type;

        // Gemini 不支持联合类型 ["string", "null"]，取第一个非 null 类型
        if (Array.isArray(t)) {
            const nonNullType = t.find(v => !(v === null || (typeof v === 'string' && v.toLowerCase() === 'null')));
            t = nonNullType || t[0] || 'string';
        }

        // 单独的 "null" 类型转为 "string"
        if (typeof t === 'string' && t.toLowerCase() === 'null') {
            t = 'string';
        }

        if (typeof t === 'string') {
            converted.type = uppercaseTypes ? t.toUpperCase() : t.toLowerCase();
        } else {
            delete converted.type;
        }
    }

    // 递归处理 properties（防止原型污染）
    if (converted.properties && typeof converted.properties === 'object' && !Array.isArray(converted.properties)) {
        const newProps = Object.create(null);
        for (const [key, value] of Object.entries(converted.properties)) {
            // 跳过危险的 key，防止原型污染
            if (DANGEROUS_KEYS.has(key)) continue;
            const convertedProp = convertJsonSchema(value, uppercaseTypes, depth + 1);
            if (convertedProp) {
                newProps[key] = convertedProp;
            }
        }
        if (Object.keys(newProps).length > 0) {
            converted.properties = newProps;
        } else {
            delete converted.properties;
        }
    } else if (converted.properties !== undefined) {
        delete converted.properties;
    }

    // 递归处理 items（数组元素的 schema）
    if (converted.items !== undefined) {
        if (Array.isArray(converted.items)) {
            // tuple 形式在上游不一定支持：取第一个可转换的 item schema
            let first = undefined;
            for (const item of converted.items) {
                const c = convertJsonSchema(item, uppercaseTypes, depth + 1);
                if (c) {
                    first = c;
                    break;
                }
            }
            if (first) converted.items = first;
            else delete converted.items;
        } else {
            const c = convertJsonSchema(converted.items, uppercaseTypes, depth + 1);
            if (c) converted.items = c;
            else delete converted.items;
        }
    }

    // 递归处理 anyOf
    if (converted.anyOf !== undefined) {
        if (Array.isArray(converted.anyOf)) {
            const newAnyOf = converted.anyOf
                .map(s => convertJsonSchema(s, uppercaseTypes, depth + 1))
                .filter(Boolean);
            if (newAnyOf.length > 0) {
                // Claude upstream (via Antigravity) rejects many valid JSON Schema features for tools.
                // In practice, `anyOf` in MCP tool schemas is a frequent trigger ("JSON schema is invalid").
                // For Claude mode (lowercase types), conservatively collapse `anyOf` to the "best" candidate
                // to keep the schema simple and acceptable.
                if (!uppercaseTypes) {
                    const preservedDescription = converted.description;
                    const preservedDefault = converted.default;
                    const chosen = pickBestAnyOfCandidate(newAnyOf);
                    if (chosen) {
                        for (const k of Object.keys(converted)) delete converted[k];
                        for (const [k, v] of Object.entries(chosen)) converted[k] = v;
                        if (preservedDescription !== undefined && converted.description === undefined) {
                            converted.description = preservedDescription;
                        }
                        if (preservedDefault !== undefined && converted.default === undefined) {
                            converted.default = preservedDefault;
                        }
                    } else {
                        delete converted.anyOf;
                    }
                } else {
                    converted.anyOf = newAnyOf;
                }
            } else {
                delete converted.anyOf;
            }
        } else {
            delete converted.anyOf;
        }
    }

    // 确保 required 是字符串数组且是 properties 的子集
    if (converted.required !== undefined) {
        // 如果没有 properties，则 required 无意义，直接删除
        if (!converted.properties || Object.keys(converted.properties).length === 0) {
            delete converted.required;
        } else if (!Array.isArray(converted.required)) {
            delete converted.required;
        } else {
            const required = [];
            const seen = new Set();
            const propsKeys = new Set(Object.keys(converted.properties));
            for (const r of converted.required) {
                if (typeof r !== 'string') continue;
                if (seen.has(r)) continue;
                // 跳过危险的 key
                if (DANGEROUS_KEYS.has(r)) continue;
                // required 必须是 properties 的子集
                if (!propsKeys.has(r)) continue;
                seen.add(r);
                required.push(r);
            }
            if (required.length > 0) {
                converted.required = required;
            } else {
                delete converted.required;
            }
        }
    }

    // 确保 enum 是非空数组（且只包含简单类型）
    if (converted.enum !== undefined) {
        if (!Array.isArray(converted.enum) || converted.enum.length === 0) {
            delete converted.enum;
        } else {
            // 过滤掉复杂类型（只保留 string, number, boolean, null）
            const simpleEnum = converted.enum.filter(v =>
                v === null ||
                typeof v === 'string' ||
                typeof v === 'number' ||
                typeof v === 'boolean'
            );
            if (simpleEnum.length > 0) {
                converted.enum = simpleEnum;
            } else {
                delete converted.enum;
            }
        }
    }

    // 确保 minItems 只能是 0 或 1（Claude 的限制），且必须是整数
    if (converted.minItems !== undefined) {
        const v = converted.minItems;
        if (Number.isInteger(v) && (v === 0 || v === 1)) {
            converted.minItems = v;
        } else {
            delete converted.minItems;
        }
    }

    // 确保 format 是 Claude 支持的格式
    if (converted.format !== undefined) {
        if (typeof converted.format !== 'string' || !SUPPORTED_STRING_FORMATS.has(converted.format)) {
            delete converted.format;
        }
    }

    // description 做类型约束
    if (converted.description !== undefined && typeof converted.description !== 'string') {
        delete converted.description;
    }

    // 若 type 丢失但还有其他字段，尽量推断一个最接近的 type
    if (converted.type === undefined && Object.keys(converted).length > 0) {
        // 如果有 anyOf，不推断 type
        if (converted.anyOf) {
            // 保持原样
        } else {
            let inferred = null;
            if (converted.properties !== undefined || converted.required !== undefined) {
                inferred = 'object';
            } else if (converted.items !== undefined) {
                inferred = 'array';
            } else if (converted.enum !== undefined && Array.isArray(converted.enum)) {
                const v = converted.enum.find(e => e !== null && e !== undefined);
                if (typeof v === 'boolean') inferred = 'boolean';
                else if (typeof v === 'number') inferred = Number.isInteger(v) ? 'integer' : 'number';
                else inferred = 'string';
            } else if (converted.format !== undefined) {
                inferred = 'string';
            } else if (converted.default !== undefined) {
                // 根据 default 值推断类型
                const d = converted.default;
                if (typeof d === 'boolean') inferred = 'boolean';
                else if (typeof d === 'number') inferred = Number.isInteger(d) ? 'integer' : 'number';
                else if (Array.isArray(d)) inferred = 'array';
                else if (d !== null && typeof d === 'object') inferred = 'object';
                else inferred = 'string';
            } else {
                inferred = 'string';
            }
            if (inferred) {
                converted.type = uppercaseTypes ? inferred.toUpperCase() : inferred.toLowerCase();
            }
        }
    }

    return Object.keys(converted).length > 0 ? converted : undefined;
}

/**
 * Parse data URL (or raw base64) into {mimeType,data}
 */
export function parseDataUrl(url) {
    // support data URL or raw base64
    if (url.startsWith('data:')) {
        const match = url.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
            return {
                mimeType: match[1],
                data: match[2]
            };
        }
    }

    // assume raw base64 PNG
    return {
        mimeType: 'image/png',
        data: url
    };
}

/**
 * Generate sessionId
 */
export function generateSessionId() {
    return String(-Math.floor(Math.random() * 9e18));
}
