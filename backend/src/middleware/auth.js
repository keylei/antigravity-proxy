/**
 * API Key 认证中间件
 * 支持两种认证方式：
 * 1. Authorization: Bearer <api_key> (OpenAI 格式)
 * 2. x-api-key: <api_key> (Anthropic 格式)
 */
export async function verifyApiKey(request, reply) {
    const configuredKeyRaw = process.env.API_KEY;
    const configuredKey = configuredKeyRaw ? String(configuredKeyRaw) : '';

    if (!configuredKey) {
        return reply.code(500).send({
            error: {
                message: 'Server misconfigured: API_KEY is not set',
                type: 'api_error',
                code: 'missing_api_key_config'
            }
        });
    }

    const authHeader = request.headers.authorization;
    const xApiKey = request.headers['x-api-key'];
    const anthropicApiKey = request.headers['anthropic-api-key'];
    const xGoogApiKey = request.headers['x-goog-api-key'];
    const queryKey = request?.query && typeof request.query === 'object' ? request.query.key : null;

    let apiKey = null;

    // 优先使用 x-api-key header (Anthropic 格式)
    if (xApiKey) {
        apiKey = xApiKey;
    }
    // 兼容更多客户端：anthropic-api-key / x-goog-api-key
    else if (anthropicApiKey) {
        apiKey = anthropicApiKey;
    } else if (xGoogApiKey) {
        apiKey = xGoogApiKey;
    }
    // 其次使用 Authorization: Bearer header (OpenAI 格式)
    else if (authHeader) {
        if (!authHeader.startsWith('Bearer ')) {
            return reply.code(401).send({
                error: {
                    message: 'Invalid Authorization header format. Expected: Bearer <api_key>',
                    type: 'invalid_request_error',
                    code: 'invalid_api_key'
                }
            });
        }
        apiKey = authHeader.slice(7);
    }
    // 兼容 Gemini 官方：?key=<api_key>
    else if (queryKey) {
        apiKey = Array.isArray(queryKey) ? queryKey[0] : queryKey;
    }
    // 没有任何认证信息
    else {
        return reply.code(401).send({
            error: {
                message: 'Missing Authorization header or API key header',
                type: 'invalid_request_error',
                code: 'missing_api_key'
            }
        });
    }

    if (!apiKey) {
        return reply.code(401).send({
            error: {
                message: 'API key is empty',
                type: 'invalid_request_error',
                code: 'invalid_api_key'
            }
        });
    }

    if (apiKey !== configuredKey) {
        return reply.code(401).send({
            error: {
                message: 'Invalid API key',
                type: 'invalid_request_error',
                code: 'invalid_api_key'
            }
        });
    }
}

/**
 * 管理员认证中间件
 * 已按需求关闭：管理面板不再要求密码/token，直接放行并赋予 admin 身份
 */
export async function verifyAdmin(request, reply) {
    request.user = { sub: 'admin', role: 'admin' };
}

// API Keys 已移除：不再提供 recordApiKeyUsage
