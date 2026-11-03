import jwt from 'jsonwebtoken';
import { SERVER_CONFIG } from '../config.js';

// JWT 密钥（生产环境应使用环境变量）
const JWT_SECRET = process.env.JWT_SECRET || 'antigravity-proxy-secret-key-2024';
const ACCESS_TOKEN_EXPIRES = '1h';
const REFRESH_TOKEN_EXPIRES = '7d';

/**
 * 生成 access token
 */
function generateAccessToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRES });
}

/**
 * 生成 refresh token
 */
function generateRefreshToken(payload) {
    return jwt.sign({ ...payload, type: 'refresh' }, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRES });
}

/**
 * 验证 token
 */
export function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return null;
    }
}

export default async function authRoutes(fastify) {
    // POST /admin/auth/login - 登录
    fastify.post('/admin/auth/login', async (request, reply) => {
        const { password, remember } = request.body;

        if (!password) {
            return reply.code(400).send({
                error: { message: 'Password is required' }
            });
        }

        // 验证密码
        if (password !== SERVER_CONFIG.admin_password) {
            return reply.code(401).send({
                error: { message: 'Invalid password' }
            });
        }

        const payload = { sub: 'admin', role: 'admin' };

        // 生成 tokens
        const accessToken = generateAccessToken(payload);
        const refreshToken = remember ? generateRefreshToken(payload) : null;

        return {
            access_token: accessToken,
            refresh_token: refreshToken,
            token_type: 'Bearer',
            expires_in: 3600 // 1 hour in seconds
        };
    });

    // POST /admin/auth/refresh - 刷新 token
    fastify.post('/admin/auth/refresh', async (request, reply) => {
        const { refresh_token } = request.body;

        if (!refresh_token) {
            return reply.code(400).send({
                error: { message: 'Refresh token is required' }
            });
        }

        const decoded = verifyToken(refresh_token);

        if (!decoded || decoded.type !== 'refresh') {
            return reply.code(401).send({
                error: { message: 'Invalid refresh token' }
            });
        }

        // 生成新的 access token
        const payload = { sub: decoded.sub, role: decoded.role };
        const accessToken = generateAccessToken(payload);

        return {
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: 3600
        };
    });

    // GET /admin/auth/me - 获取当前用户信息
    fastify.get('/admin/auth/me', {
        preHandler: async (request, reply) => {
            const authHeader = request.headers.authorization;

            if (!authHeader?.startsWith('Bearer ')) {
                return reply.code(401).send({
                    error: { message: 'Missing authorization header' }
                });
            }

            const token = authHeader.slice(7);
            const decoded = verifyToken(token);

            if (!decoded) {
                return reply.code(401).send({
                    error: { message: 'Invalid token' }
                });
            }

            request.user = decoded;
        }
    }, async (request) => {
        return {
            username: request.user.sub,
            role: request.user.role
        };
    });
}
