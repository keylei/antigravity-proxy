/**
 * 开发环境入口
 * 调用 startServer() 启动服务器
 */
import { startServer } from './index.js';

startServer().catch((err) => {
    console.error(err?.stack || String(err));
    process.exit(1);
});
