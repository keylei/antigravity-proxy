/**
 * Antigravity Proxy - 前端应用入口
 * 重构版：模块化、响应式状态管理、智能DOM更新
 */

// 核心模块
import { store } from './core/store.js';
import { commands } from './commands/index.js';

// 组件
import { Shell } from './components/shell.js';
import { Login } from './components/login.js';
import { Dashboard } from './components/dashboard.js';
import { AccountsPage } from './components/accounts/index.js';
import { LogsPage } from './components/logs/index.js';

// UI
import { toast } from './ui/toast.js';

class App {
  constructor() {
    this._root = document.getElementById('app');
    this._shell = null;
    this._currentPage = null;
    this._loginPage = null;
  }

  /**
   * 启动应用
   */
  async init() {
    // 初始化主题
    await commands.dispatch('theme:init');

    // 检查登录状态
    const isLoggedIn = await commands.dispatch('auth:check');

    // 监听用户状态变化
    store.subscribe('user', (user) => {
      this._handleUserChange(user);
    });

    // 监听 Tab 变化
    store.subscribe('activeTab', (tab) => {
      this._handleTabChange(tab);
    });

    // 初始渲染
    if (isLoggedIn) {
      this._renderShell();
      await commands.dispatch('nav:change', { tab: 'dashboard' });
    } else {
      this._renderLogin();
    }
  }

  /**
   * 处理用户状态变化
   */
  _handleUserChange(user) {
    if (user) {
      // 用户已登录
      if (!this._shell) {
        this._renderShell();
        commands.dispatch('nav:change', { tab: store.get('activeTab') || 'dashboard' });
      }
    } else {
      // 用户未登录
      this._unmountAll();
      this._renderLogin();
    }
  }

  /**
   * 处理 Tab 变化
   */
  _handleTabChange(tab) {
    if (!store.get('user')) return;

    // 卸载当前页面
    if (this._currentPage) {
      this._currentPage.unmount();
      this._currentPage = null;
    }

    // 获取内容容器
    const pageContent = document.getElementById('pageContent');
    if (!pageContent) return;

    // 添加淡出效果
    pageContent.classList.add('page-exit');
    pageContent.classList.remove('page-enter');

    // 等待淡出完成后切换内容
    setTimeout(() => {
      // 渲染对应页面
      switch (tab) {
        case 'dashboard':
          this._currentPage = new Dashboard(pageContent);
          break;
        case 'accounts':
          this._currentPage = new AccountsPage(pageContent);
          break;
        case 'logs':
          this._currentPage = new LogsPage(pageContent);
          break;
        default:
          this._currentPage = new Dashboard(pageContent);
      }

      if (this._currentPage) {
        this._currentPage.mount();
      }

      // 添加淡入效果
      pageContent.classList.remove('page-exit');
      pageContent.classList.add('page-enter');
    }, 150);
  }

  /**
   * 渲染登录页
   */
  _renderLogin() {
    if (this._loginPage) return;

    this._loginPage = new Login(this._root, {
      onSuccess: () => {
        // 登录成功由 user 状态变化触发
      }
    });
    this._loginPage.mount();
  }

  /**
   * 渲染应用外壳
   */
  _renderShell() {
    // 先卸载登录页
    if (this._loginPage) {
      this._loginPage.unmount();
      this._loginPage = null;
    }

    // 渲染 Shell
    this._shell = new Shell(this._root);
    this._shell.mount();
    this._handleTabChange(store.get('activeTab') || 'dashboard');
  }

  /**
   * 卸载所有组件
   */
  _unmountAll() {
    if (this._currentPage) {
      this._currentPage.unmount();
      this._currentPage = null;
    }

    if (this._shell) {
      this._shell.unmount();
      this._shell = null;
    }

    if (this._loginPage) {
      this._loginPage.unmount();
      this._loginPage = null;
    }
  }
}

// 创建并启动应用
const app = new App();

// 等待 DOM 就绪
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => app.init());
} else {
  app.init();
}

// 全局错误处理
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  
  // 不显示取消请求的错误
  if (event.reason?.message?.includes('请求已取消')) {
    event.preventDefault();
    return;
  }
  
  toast.error(event.reason?.message || '发生错误');
});

// 暴露到全局方便调试
if (typeof window !== 'undefined') {
  window.__APP__ = app;
  window.__STORE__ = store;
  window.__COMMANDS__ = commands;
}

export default app;
