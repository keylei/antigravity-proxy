/**
 * 命令调度器
 * 统一管理所有用户操作，提供中间件支持、防重复执行
 */

class CommandDispatcher {
  constructor() {
    this._handlers = new Map();
    this._middleware = [];
    this._pending = new Map();  // 防止重复执行
  }

  /**
   * 注册命令处理器
   * @param {string} name - 命令名称，如 'accounts:load'
   * @param {Function} handler - 异步处理函数
   */
  register(name, handler) {
    if (this._handlers.has(name)) {
      console.warn(`Command "${name}" is being overwritten`);
    }
    this._handlers.set(name, handler);
  }

  /**
   * 批量注册命令
   * @param {Object} commands - { commandName: handler }
   */
  registerAll(commands) {
    Object.entries(commands).forEach(([name, handler]) => {
      this.register(name, handler);
    });
  }

  /**
   * 添加中间件
   * @param {Object} middleware - { before?, after?, onError? }
   */
  use(middleware) {
    this._middleware.push(middleware);
  }

  /**
   * 执行命令
   * @param {string} name - 命令名称
   * @param {Object} payload - 命令参数
   * @returns {Promise<any>} 命令执行结果
   */
  async dispatch(name, payload = {}) {
    const handler = this._handlers.get(name);
    
    if (!handler) {
      console.warn(`Unknown command: ${name}`);
      return undefined;
    }

    // 防重复执行（使用 _dedupKey 或命令名作为键）
    const dedupKey = payload._dedupKey || name;
    if (this._pending.has(dedupKey)) {
      console.log(`Command "${name}" is already pending, skipping`);
      return this._pending.get(dedupKey);
    }

    // 创建命令上下文
    const context = {
      name,
      payload,
      startTime: Date.now(),
      result: undefined,
      error: null
    };

    // 创建执行 Promise
    const executePromise = this._execute(context, handler);
    
    // 存储 Promise 用于去重
    this._pending.set(dedupKey, executePromise);

    try {
      return await executePromise;
    } finally {
      this._pending.delete(dedupKey);
    }
  }

  /**
   * 内部执行逻辑
   * @private
   */
  async _execute(context, handler) {
    try {
      // 执行前中间件
      for (const mw of this._middleware) {
        if (mw.before) {
          await mw.before(context);
        }
      }

      // 执行命令
      context.result = await handler(context.payload);

      // 执行后中间件
      for (const mw of this._middleware) {
        if (mw.after) {
          await mw.after(context);
        }
      }

      return context.result;

    } catch (error) {
      context.error = error;

      // 错误中间件
      for (const mw of this._middleware) {
        if (mw.onError) {
          try {
            await mw.onError(context);
          } catch (mwError) {
            console.error('Error in command middleware:', mwError);
          }
        }
      }

      throw error;
    }
  }

  /**
   * 检查命令是否正在执行
   * @param {string} name - 命令名称或去重键
   */
  isPending(name) {
    return this._pending.has(name);
  }

  /**
   * 获取所有已注册的命令名称
   */
  getRegisteredCommands() {
    return [...this._handlers.keys()];
  }
}

// 创建全局命令调度器实例
export const commands = new CommandDispatcher();

// 检查是否启用调试模式（浏览器兼容）
const isDebugMode = () => {
  try {
    return localStorage.getItem('debug') === 'true' || localStorage.getItem('debug') === '1';
  } catch {
    return false;
  }
};

// 默认日志中间件
commands.use({
  before(ctx) {
    if (isDebugMode()) {
      console.log(`[CMD] ${ctx.name}`, ctx.payload);
    }
  },
  after(ctx) {
    if (isDebugMode()) {
      console.log(`[CMD] ${ctx.name} completed in ${Date.now() - ctx.startTime}ms`);
    }
  },
  onError(ctx) {
    console.error(`[CMD] ${ctx.name} failed:`, ctx.error);
  }
});

export default commands;