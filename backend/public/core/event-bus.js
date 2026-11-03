/**
 * 事件总线
 * 用于组件间通信和全局事件处理
 */

class EventBus {
  constructor() {
    this._listeners = new Map();
    this._onceListeners = new Map();
  }

  /**
   * 订阅事件
   * @param {string} event - 事件名称
   * @param {Function} callback - 回调函数
   * @returns {Function} 取消订阅函数
   */
  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);

    // 返回取消订阅函数
    return () => this.off(event, callback);
  }

  /**
   * 订阅事件（只触发一次）
   * @param {string} event - 事件名称
   * @param {Function} callback - 回调函数
   * @returns {Function} 取消订阅函数
   */
  once(event, callback) {
    if (!this._onceListeners.has(event)) {
      this._onceListeners.set(event, new Set());
    }
    this._onceListeners.get(event).add(callback);

    return () => {
      const listeners = this._onceListeners.get(event);
      if (listeners) {
        listeners.delete(callback);
      }
    };
  }

  /**
   * 取消订阅
   * @param {string} event - 事件名称
   * @param {Function} callback - 回调函数（可选，不传则移除所有）
   */
  off(event, callback) {
    if (callback) {
      // 移除特定回调
      const listeners = this._listeners.get(event);
      if (listeners) {
        listeners.delete(callback);
        if (listeners.size === 0) {
          this._listeners.delete(event);
        }
      }
      
      const onceListeners = this._onceListeners.get(event);
      if (onceListeners) {
        onceListeners.delete(callback);
        if (onceListeners.size === 0) {
          this._onceListeners.delete(event);
        }
      }
    } else {
      // 移除该事件的所有监听器
      this._listeners.delete(event);
      this._onceListeners.delete(event);
    }
  }

  /**
   * 触发事件
   * @param {string} event - 事件名称
   * @param {any} data - 事件数据
   */
  emit(event, data) {
    // 触发普通监听器
    const listeners = this._listeners.get(event);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(data);
        } catch (err) {
          console.error(`Error in event listener for "${event}":`, err);
        }
      });
    }

    // 触发一次性监听器
    const onceListeners = this._onceListeners.get(event);
    if (onceListeners) {
      onceListeners.forEach(callback => {
        try {
          callback(data);
        } catch (err) {
          console.error(`Error in once listener for "${event}":`, err);
        }
      });
      // 清空一次性监听器
      this._onceListeners.delete(event);
    }
  }

  /**
   * 清除所有监听器
   */
  clear() {
    this._listeners.clear();
    this._onceListeners.clear();
  }

  /**
   * 获取事件的监听器数量
   * @param {string} event - 事件名称
   */
  listenerCount(event) {
    const regular = this._listeners.get(event)?.size || 0;
    const once = this._onceListeners.get(event)?.size || 0;
    return regular + once;
  }

  /**
   * 获取所有注册的事件名称
   */
  eventNames() {
    const names = new Set([
      ...this._listeners.keys(),
      ...this._onceListeners.keys()
    ]);
    return [...names];
  }
}

// 创建全局事件总线实例
export const eventBus = new EventBus();

// 预定义事件名称常量
export const Events = {
  // 用户相关
  USER_LOGIN: 'user:login',
  USER_LOGOUT: 'user:logout',
  
  // 导航相关
  TAB_CHANGE: 'tab:change',
  
  // 数据相关
  DATA_REFRESH: 'data:refresh',
  ACCOUNTS_UPDATED: 'accounts:updated',
  LOGS_UPDATED: 'logs:updated',
  
  // 弹窗相关
  DIALOG_OPEN: 'dialog:open',
  DIALOG_CLOSE: 'dialog:close',
  
  // 通知相关
  TOAST_SHOW: 'toast:show',
  
  // 主题相关
  THEME_CHANGE: 'theme:change'
};

export default eventBus;