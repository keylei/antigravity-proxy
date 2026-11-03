/**
 * 组件基类
 * 提供生命周期管理、智能DOM更新、事件绑定和自动清理
 */

import { store } from './store.js';

export class Component {
  /**
   * @param {string|HTMLElement} container - 容器选择器或元素
   * @param {Object} props - 组件属性
   */
  constructor(container, props = {}) {
    this.container = typeof container === 'string'
      ? document.querySelector(container)
      : container;
    
    if (!this.container) {
      console.warn('Component container not found:', container);
    }
    
    this.props = props;
    this.state = {};
    this._subscriptions = [];
    this._eventCleanups = [];
    this._childComponents = [];
    this._mounted = false;
  }

  /**
   * 渲染模板（子类必须实现）
   * @returns {string} HTML字符串
   */
  render() {
    throw new Error('Component.render() must be implemented');
  }

  /**
   * 挂载组件
   */
  mount() {
    if (!this.container) return;
    
    this._mounted = true;
    this.container.innerHTML = this.render().trim();
    this._bindEvents();
    this.onMount();
  }

  /**
   * 更新组件（智能diff）
   */
  update() {
    if (!this._mounted || !this.container) return;
    
    const newHtml = this.render();
    this._patchDOM(newHtml);
    
    // 重新绑定事件
    this._cleanupEvents();
    this._bindEvents();
    
    this.onUpdate();
  }

  /**
   * 卸载组件
   */
  unmount() {
    this._mounted = false;
    
    // 卸载子组件
    this._childComponents.forEach(child => child.unmount());
    this._childComponents = [];
    
    // 清理订阅
    this._subscriptions.forEach(unsub => unsub());
    this._subscriptions = [];
    
    // 清理事件
    this._cleanupEvents();
    
    this.onUnmount();
    
    if (this.container) {
      this.container.innerHTML = '';
    }
  }

  /**
   * 订阅 Store 状态变化（自动清理）
   * @param {string} path - Store 路径
   * @param {Function} callback - 回调函数
   * @returns {Function} 取消订阅函数
   */
  subscribe(path, callback) {
    const unsub = store.subscribe(path, callback);
    this._subscriptions.push(unsub);
    return unsub;
  }

  /**
   * 监听 Store 并自动更新组件
   * @param {string|string[]} paths - 要监听的路径
   */
  watch(paths) {
    const pathList = Array.isArray(paths) ? paths : [paths];
    pathList.forEach(path => {
      this.subscribe(path, () => this.update());
    });
  }

  /**
   * 绑定 DOM 事件（自动清理）
   * @param {string} selector - CSS 选择器
   * @param {string} event - 事件名称
   * @param {Function} handler - 事件处理函数
   * @param {Object} options - 选项 { debounce: number }
   */
  on(selector, event, handler, options = {}) {
    const elements = this.container.querySelectorAll(selector);
    
    const wrappedHandler = (e) => {
      if (options.debounce) {
        clearTimeout(handler._debounceTimer);
        handler._debounceTimer = setTimeout(
          () => handler.call(this, e),
          options.debounce
        );
      } else {
        handler.call(this, e);
      }
    };

    elements.forEach(el => {
      el.addEventListener(event, wrappedHandler, options.capture || false);
      this._eventCleanups.push(() => 
        el.removeEventListener(event, wrappedHandler, options.capture || false)
      );
    });
  }

  /**
   * 事件委托（高效处理动态元素）
   * @param {string} event - 事件名称
   * @param {string} selector - CSS 选择器
   * @param {Function} handler - 事件处理函数
   */
  delegate(event, selector, handler) {
    const wrappedHandler = (e) => {
      const target = e.target.closest(selector);
      if (target && this.container.contains(target)) {
        handler.call(this, e, target);
      }
    };

    this.container.addEventListener(event, wrappedHandler);
    this._eventCleanups.push(() =>
      this.container.removeEventListener(event, wrappedHandler)
    );
  }

  /**
   * 注册子组件
   * @param {Component} child - 子组件实例
   */
  addChild(child) {
    this._childComponents.push(child);
    return child;
  }

  /**
   * 设置组件内部状态并触发更新
   * @param {Object} newState - 新状态
   */
  setState(newState) {
    this.state = { ...this.state, ...newState };
    this.update();
  }

  // ============ 生命周期钩子（子类覆盖） ============

  /**
   * 组件挂载后调用
   */
  onMount() {}

  /**
   * 组件更新后调用
   */
  onUpdate() {}

  /**
   * 组件卸载前调用
   */
  onUnmount() {}

  /**
   * 绑定事件（子类覆盖）
   */
  _bindEvents() {}

  // ============ 私有方法 ============

  /**
   * 清理事件监听器
   * @private
   */
  _cleanupEvents() {
    this._eventCleanups.forEach(cleanup => cleanup());
    this._eventCleanups = [];
  }

  /**
   * 智能 DOM 更新（类似 morphdom）
   * @private
   */
  _patchDOM(newHtml) {
    const template = document.createElement('template');
    template.innerHTML = newHtml.trim();
    const newDOM = template.content.firstChild;

    if (!newDOM) {
      this.container.innerHTML = '';
      return;
    }

    if (!this.container.firstChild) {
      this.container.appendChild(newDOM.cloneNode(true));
      return;
    }

    this._morphNode(this.container.firstChild, newDOM);
  }

  /**
   * 递归比较和更新节点
   * @private
   */
  _morphNode(oldNode, newNode) {
    // 新节点不存在，删除旧节点
    if (!newNode) {
      oldNode.remove();
      return;
    }

    // 旧节点不存在，添加新节点
    if (!oldNode) {
      return;
    }

    // 节点类型不同，直接替换
    if (oldNode.nodeType !== newNode.nodeType ||
        oldNode.nodeName !== newNode.nodeName) {
      oldNode.replaceWith(newNode.cloneNode(true));
      return;
    }

    // 文本节点
    if (oldNode.nodeType === Node.TEXT_NODE) {
      if (oldNode.textContent !== newNode.textContent) {
        oldNode.textContent = newNode.textContent;
      }
      return;
    }

    // 元素节点
    if (oldNode.nodeType === Node.ELEMENT_NODE) {
      // 更新属性
      this._updateAttributes(oldNode, newNode);

      if (oldNode.hasAttribute && oldNode.hasAttribute('data-preserve-children')) {
        return;
      }

      // 特殊处理：保持焦点元素的值不变
      if (document.activeElement === oldNode) {
        if (oldNode.tagName === 'INPUT' || 
            oldNode.tagName === 'TEXTAREA' || 
            oldNode.tagName === 'SELECT') {
          // 不更新正在编辑的输入框
          return;
        }
      }

      // 递归更新子节点
      const oldChildren = [...oldNode.childNodes];
      const newChildren = [...newNode.childNodes];
      const maxLen = Math.max(oldChildren.length, newChildren.length);

      for (let i = 0; i < maxLen; i++) {
        if (i >= oldChildren.length) {
          // 添加新子节点
          oldNode.appendChild(newChildren[i].cloneNode(true));
        } else if (i >= newChildren.length) {
          // 删除多余的旧子节点
          oldChildren[i].remove();
        } else {
          // 递归比较
          this._morphNode(oldChildren[i], newChildren[i]);
        }
      }
    }
  }

  /**
   * 更新元素属性
   * @private
   */
  _updateAttributes(oldEl, newEl) {
    // 移除旧属性
    const oldAttrs = [...oldEl.attributes];
    for (const attr of oldAttrs) {
      if (!newEl.hasAttribute(attr.name)) {
        if (oldEl.tagName === 'DIALOG' && attr.name === 'open') continue;
        oldEl.removeAttribute(attr.name);
      }
    }

    // 添加/更新新属性
    const newAttrs = [...newEl.attributes];
    for (const attr of newAttrs) {
      if (oldEl.tagName === 'DIALOG' && attr.name === 'open') continue;
      if (oldEl.getAttribute(attr.name) !== attr.value) {
        oldEl.setAttribute(attr.name, attr.value);
      }
    }

    // 特殊处理：表单元素的 value 和 checked
    if (oldEl.tagName === 'INPUT') {
      if (oldEl.type === 'checkbox' || oldEl.type === 'radio') {
        if (oldEl.checked !== newEl.checked) {
          oldEl.checked = newEl.checked;
        }
      } else if (oldEl !== document.activeElement) {
        if (oldEl.value !== newEl.value) {
          oldEl.value = newEl.value;
        }
      }
    }

    if (oldEl.tagName === 'TEXTAREA' && oldEl !== document.activeElement) {
      if (oldEl.value !== newEl.value) {
        oldEl.value = newEl.value;
      }
    }

    if (oldEl.tagName === 'SELECT' && oldEl !== document.activeElement) {
      if (oldEl.value !== newEl.value) {
        oldEl.value = newEl.value;
      }
    }
  }

  /**
   * HTML 转义
   * @protected
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

  /**
   * 格式化时间
   * @protected
   */
  _formatTime(ts) {
    if (!ts) return '-';
    try {
      const d = new Date(Number(ts));
      return d.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return '-';
    }
  }

  /**
   * 格式化数字
   * @protected
   */
  _formatNumber(n) {
    return typeof n === 'number' ? n.toLocaleString('zh-CN') : '-';
  }
}

export default Component;
