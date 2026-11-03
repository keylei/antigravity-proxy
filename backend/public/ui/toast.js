/**
 * Toast 通知管理器
 * 提供多种类型的通知，支持持久化、操作按钮、加载状态更新
 */

class ToastManager {
  constructor() {
    this._container = null;
    this._dialogContainer = null;
    this._toasts = new Set();
    this._maxVisible = 5;
    this._init();
  }

  /**
   * 初始化容器
   * @private
   */
  _init() {
    // 确保 DOM 已就绪
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this._createContainer());
    } else {
      this._createContainer();
    }
  }

  /**
   * 创建容器
   * @private
   */
  _createContainer() {
    if (this._container) return;
    
    this._container = document.createElement('div');
    this._container.className = 'toast-container';
    this._container.setAttribute('aria-live', 'polite');
    this._container.setAttribute('aria-label', '通知');
    document.body.appendChild(this._container);
  }

  /**
   * Ensure an in-dialog container exists for mirroring toasts while a modal <dialog> is open.
   * @private
   */
  _ensureDialogContainer(modalDialog) {
    if (!modalDialog) return null;

    if (!this._dialogContainer) {
      this._dialogContainer = document.createElement('div');
      this._dialogContainer.className = 'toast-container toast-container--in-dialog';
      this._dialogContainer.setAttribute('aria-live', 'polite');
      this._dialogContainer.setAttribute('aria-label', '通知');
    }

    if (this._dialogContainer.parentNode !== modalDialog) {
      modalDialog.appendChild(this._dialogContainer);
    }

    return this._dialogContainer;
  }

  /**
   * Ensure the toast container is visible and on top (especially when modal dialogs are open).
   * @private
   */
  _ensurePresented() {
    if (!this._container) return;
    if (this._container.parentNode !== document.body) {
      document.body.appendChild(this._container);
    }
  }

  /**
   * @private
   */
  _getActiveModalDialog() {
    // Prefer :modal when supported.
    try {
      const modal = document.querySelector('dialog:modal');
      if (modal) return modal;
    } catch {
      // ignore
    }

    // Fallback: find any open dialog and use the last one (closest to "top-most").
    const dialogs = Array.from(document.querySelectorAll('dialog[open]'));
    return dialogs.length ? dialogs[dialogs.length - 1] : null;
  }

  /**
   * 显示通知
   * @param {string} message - 消息内容
   * @param {string} type - 类型：info, success, error, warning, loading
   * @param {Object} options - 选项
   * @returns {Object} toast 控制对象 { update, close }
   */
  show(message, type = 'info', options = {}) {
    this._createContainer();
    this._ensurePresented();

    const {
      duration = 3000,
      action = null,      // { text: string, onClick: Function }
      persistent = false, // 是否持久显示（需手动关闭）
      id = null          // 自定义ID，用于更新特定toast
    } = options;

    // 如果有相同ID的toast，先移除
    if (id) {
      this._removeById(id);
    }

    const icons = {
      info: 'ℹ️',
      success: '✅',
      error: '❌',
      warning: '⚠️',
      loading: ''
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'alert');
    if (id) toast.dataset.toastId = id;

    toast.innerHTML = `
      ${type === 'loading' 
        ? '<div class="spinner"></div>' 
        : `<span class="toast-icon">${icons[type] || icons.info}</span>`
      }
      <span class="toast-message">${this._escape(message)}</span>
      ${action ? `
        <button class="toast-action" type="button">${this._escape(action.text)}</button>
      ` : ''}
      ${persistent || type === 'loading' ? `
        <button class="toast-close" type="button" aria-label="关闭">✕</button>
      ` : ''}
    `;

    // If there's an active modal dialog, also render a mirrored toast inside it so it's visible immediately.
    const modal = this._getActiveModalDialog();
    const dialogContainer = modal ? this._ensureDialogContainer(modal) : null;

    let toastMirror = null;
    if (dialogContainer) {
      toastMirror = toast.cloneNode(true);
      // Keep a reference so we can remove it together.
      toast._toastMirror = toastMirror;
      dialogContainer.appendChild(toastMirror);
    }

    // 绑定事件
    if (action) {
      const actionBtn = toast.querySelector('.toast-action');
      actionBtn.addEventListener('click', () => {
        action.onClick?.();
        this._remove(toast);
      });
    }

    const closeBtn = toast.querySelector('.toast-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this._remove(toast));
    }

    if (toastMirror) {
      if (action) {
        const mirrorActionBtn = toastMirror.querySelector('.toast-action');
        if (mirrorActionBtn) {
          mirrorActionBtn.addEventListener('click', () => {
            action.onClick?.();
            this._remove(toast);
          });
        }
      }

      const mirrorCloseBtn = toastMirror.querySelector('.toast-close');
      if (mirrorCloseBtn) {
        mirrorCloseBtn.addEventListener('click', () => this._remove(toast));
      }
    }

    // 添加到全局容器（会在 dialog 关闭后可见）
    this._container.appendChild(toast);
    this._toasts.add(toast);

    // 限制最大显示数量
    this._enforceMaxVisible();

    // 触发动画
    requestAnimationFrame(() => {
      toast.classList.add('show');
      if (toastMirror) toastMirror.classList.add('show');
    });

    // 自动关闭
    let timeoutId = null;
    if (!persistent && type !== 'loading' && duration > 0) {
      timeoutId = setTimeout(() => this._remove(toast), duration);
    }

    // 返回控制对象
    return {
      /**
       * 更新消息和类型
       */
      update: (newMessage, newType) => {
        // 清除自动关闭定时器
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        const effectiveType = newType || type;
        toast.className = `toast toast-${effectiveType} show`;
        if (toastMirror) toastMirror.className = `toast toast-${effectiveType} show`;
        
        const messageEl = toast.querySelector('.toast-message');
        if (messageEl) {
          messageEl.textContent = newMessage;
        }
        const mirrorMessageEl = toastMirror?.querySelector?.('.toast-message');
        if (mirrorMessageEl) {
          mirrorMessageEl.textContent = newMessage;
        }

        // 更新图标
        const iconEl = toast.querySelector('.toast-icon');
        const spinner = toast.querySelector('.spinner');
        const mirrorIconEl = toastMirror?.querySelector?.('.toast-icon');
        const mirrorSpinner = toastMirror?.querySelector?.('.spinner');
        
        if (effectiveType && effectiveType !== 'loading') {
          if (spinner) {
            spinner.remove();
          }
          if (mirrorSpinner) {
            mirrorSpinner.remove();
          }
          if (!iconEl) {
            const newIcon = document.createElement('span');
            newIcon.className = 'toast-icon';
            newIcon.textContent = icons[effectiveType] || icons.info;
            toast.insertBefore(newIcon, messageEl);
            if (toastMirror && !mirrorIconEl) {
              const newMirrorIcon = document.createElement('span');
              newMirrorIcon.className = 'toast-icon';
              newMirrorIcon.textContent = icons[effectiveType] || icons.info;
              toastMirror.insertBefore(newMirrorIcon, mirrorMessageEl);
            }
          } else {
            iconEl.textContent = icons[effectiveType] || icons.info;
            if (mirrorIconEl) mirrorIconEl.textContent = icons[effectiveType] || icons.info;
          }
        }

        // 如果更新为非loading类型，设置自动关闭
        if (effectiveType && effectiveType !== 'loading' && !persistent) {
          timeoutId = setTimeout(() => this._remove(toast), duration);
        }
      },

      /**
       * 关闭通知
       */
      close: () => this._remove(toast),

      /**
       * 获取 DOM 元素
       */
      element: toast
    };
  }

  /**
   * 移除toast
   * @private
   */
  _remove(toast) {
    if (!toast || !this._toasts.has(toast)) return;

    const toastMirror = toast._toastMirror;
    if (toastMirror) {
      toastMirror.classList.remove('show');
      setTimeout(() => {
        toastMirror.remove();
      }, 400);
      toast._toastMirror = null;
    }

    toast.classList.remove('show');
    this._toasts.delete(toast);

    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 400);
  }

  /**
   * 通过ID移除
   * @private
   */
  _removeById(id) {
    const toast = this._container?.querySelector(`[data-toast-id="${id}"]`);
    if (toast) {
      this._remove(toast);
    }
  }

  /**
   * 限制最大显示数量
   * @private
   */
  _enforceMaxVisible() {
    while (this._toasts.size > this._maxVisible) {
      const oldest = this._toasts.values().next().value;
      this._remove(oldest);
    }
  }

  /**
   * HTML转义
   * @private
   */
  _escape(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, m => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[m]));
  }

  // ============ 便捷方法 ============

  info(message, options) {
    return this.show(message, 'info', options);
  }

  success(message, options) {
    return this.show(message, 'success', options);
  }

  error(message, options) {
    return this.show(message, 'error', options);
  }

  warning(message, options) {
    return this.show(message, 'warning', options);
  }

  /**
   * 显示加载状态（持久显示，需手动关闭或更新）
   */
  loading(message, options = {}) {
    return this.show(message, 'loading', { ...options, persistent: true });
  }

  /**
   * 清除所有通知
   */
  clear() {
    this._toasts.forEach(toast => this._remove(toast));
  }
}

// 创建全局实例
export const toast = new ToastManager();

export default toast;
