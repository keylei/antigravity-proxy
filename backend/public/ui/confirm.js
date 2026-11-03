/**
 * 确认对话框
 * 替代原生 confirm()，提供统一的UI风格
 */

class ConfirmDialog {
  constructor() {
    this._dialog = null;
    this._resolve = null;
    this._init();
  }

  /**
   * 初始化
   * @private
   */
  _init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this._createDOM());
    } else {
      this._createDOM();
    }
  }

  /**
   * 创建DOM
   * @private
   */
  _createDOM() {
    if (this._dialog) return;

    const html = `
      <dialog id="confirmDialog" class="confirm-dialog">
        <div class="dialog-header">
          <div class="dialog-title" id="confirmTitle">确认</div>
        </div>
        <div class="dialog-body">
          <p id="confirmMessage"></p>
        </div>
        <div class="dialog-footer">
          <button class="btn" data-action="cancel" type="button">取消</button>
          <button class="btn btn-primary" data-action="confirm" type="button">确认</button>
        </div>
      </dialog>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
    this._dialog = document.getElementById('confirmDialog');

    // 事件绑定
    this._dialog.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      if (action === 'confirm') {
        this._close(true);
      } else if (action === 'cancel') {
        this._close(false);
      }
    });

    // ESC 键关闭
    this._dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      this._close(false);
    });

    // 点击背景关闭
    this._dialog.addEventListener('click', (e) => {
      if (e.target === this._dialog) {
        this._close(false);
      }
    });

    // 键盘导航
    this._dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.dataset.action !== 'cancel') {
        e.preventDefault();
        this._close(true);
      }
    });
  }

  /**
   * 显示确认对话框
   * @param {Object} options - 配置选项
   * @returns {Promise<boolean>} 用户选择结果
   */
  show({
    title = '确认',
    message,
    confirmText = '确认',
    cancelText = '取消',
    danger = false,
    icon = null
  } = {}) {
    this._createDOM();

    const titleEl = document.getElementById('confirmTitle');
    const messageEl = document.getElementById('confirmMessage');
    const confirmBtn = this._dialog.querySelector('[data-action="confirm"]');
    const cancelBtn = this._dialog.querySelector('[data-action="cancel"]');

    // 设置内容
    titleEl.textContent = title;
    messageEl.innerHTML = icon 
      ? `<span class="confirm-icon">${icon}</span>${this._escape(message)}`
      : this._escape(message);

    // 设置按钮
    confirmBtn.textContent = confirmText;
    confirmBtn.className = danger ? 'btn btn-danger' : 'btn btn-primary';
    cancelBtn.textContent = cancelText;

    // 显示对话框
    this._dialog.showModal();

    // 聚焦到确认按钮
    setTimeout(() => confirmBtn.focus(), 50);

    return new Promise(resolve => {
      this._resolve = resolve;
    });
  }

  /**
   * 关闭对话框
   * @private
   */
  _close(result) {
    this._dialog.close();
    if (this._resolve) {
      this._resolve(result);
      this._resolve = null;
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

  /**
   * 删除确认
   */
  delete(itemName) {
    return this.show({
      title: '删除确认',
      message: `确定要删除 "${itemName}" 吗？此操作不可恢复。`,
      confirmText: '删除',
      danger: true,
      icon: '🗑️'
    });
  }

  /**
   * 危险操作确认
   */
  danger(message, title = '危险操作') {
    return this.show({
      title,
      message,
      confirmText: '继续',
      danger: true,
      icon: '⚠️'
    });
  }

  /**
   * 普通确认
   */
  ask(message, title = '确认') {
    return this.show({
      title,
      message,
      confirmText: '确定',
      danger: false
    });
  }
}

// 创建全局实例
export const confirm = new ConfirmDialog();

export default confirm;