/**
 * 设备指纹/会话管理
 * 为每个账号生成并持久化设备标识，使请求看起来来自真实的独立客户端。
 */
import crypto from 'crypto';

/**
 * 数据库迁移：为 accounts 表添加设备指纹字段
 * 使用 ALTER TABLE ADD COLUMN（SQLite 支持，幂等安全）
 */
export function migrateDeviceIdentityColumns(db) {
    const tableInfo = db.prepare("PRAGMA table_info(accounts)").all();
    const columns = new Set(tableInfo.map(c => c.name));

    const additions = [
        ['instance_id', 'TEXT'],
        ['device_fingerprint', 'TEXT'],
        ['session_id', 'TEXT'],
    ];

    for (const [name, type] of additions) {
        if (!columns.has(name)) {
            db.exec(`ALTER TABLE accounts ADD COLUMN ${name} ${type}`);
        }
    }
}

/**
 * 生成仿真 Windows 机器名格式的 instance_id
 * 格式: LAPTOP-XXXXXXXX\xxxx-LAPTOP-XXXXXXXX（两段 LAPTOP 后缀相同）
 */
function generateInstanceId() {
    const alphanums = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const lowers = 'abcdefghijklmnopqrstuvwxyz';
    const randomChars = (charset, len) => {
        const bytes = crypto.randomBytes(len);
        return Array.from(bytes).map(b => charset[b % charset.length]).join('');
    };
    const machineId = randomChars(alphanums, 8);
    const username = randomChars(lowers, 4);
    return `LAPTOP-${machineId}\\${username}-LAPTOP-${machineId}`;
}

/**
 * 确保账号拥有设备标识，没有则生成并写入数据库
 * @param {Object} db - better-sqlite3 实例
 * @param {Object} account - 账号对象（含 id）
 * @returns {Object} 包含 instance_id, device_fingerprint, session_id 的账号
 */
export function ensureDeviceIdentity(db, account) {
    if (account.instance_id && account.device_fingerprint && account.session_id) {
        return account;
    }

    const instanceId = account.instance_id || generateInstanceId();
    const deviceFingerprint = account.device_fingerprint || crypto.randomUUID();
    const sessionId = account.session_id || String(-Math.floor(Math.random() * 9e18));

    db.prepare(`
        UPDATE accounts
        SET instance_id = ?, device_fingerprint = ?, session_id = ?
        WHERE id = ?
    `).run(instanceId, deviceFingerprint, sessionId, account.id);

    account.instance_id = instanceId;
    account.device_fingerprint = deviceFingerprint;
    account.session_id = sessionId;

    return account;
}

/**
 * 轮换 session_id（用于模拟新会话）
 */
export function rotateSessionId(db, account) {
    const newSessionId = String(-Math.floor(Math.random() * 9e18));
    db.prepare('UPDATE accounts SET session_id = ? WHERE id = ?').run(newSessionId, account.id);
    account.session_id = newSessionId;
    return account;
}
