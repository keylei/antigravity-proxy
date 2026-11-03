import { Component } from '../core/component.js';
import { store } from '../core/store.js';
import { commands } from '../commands/index.js';

export class Shell extends Component {
  constructor(container) {
    super(container);
    this._tabSliderInited = false;
  }

  render() {
    const theme = store.get('theme');
    const activeTab = store.get('activeTab');
    const user = store.get('user');

    return `
      <div class="app-shell">
        <div class="container">
          <header class="app-header">
            <div class="brand">
              <span class="brand-name">Antigravity</span>
              <span class="brand-tag">Proxy</span>
            </div>
            <div class="header-right">
              <span class="user-info">
                ${this._escape(user?.username || 'Admin')}
              </span>
              <button class="btn btn-sm btn-danger" data-cmd="auth:logout">
                退出
              </button>
            </div>
          </header>

          <div class="tabs-container">
            <nav class="tabs">
              <div class="tab-slider"></div>
              <button class="tab ${activeTab === 'dashboard' ? 'active' : ''}"
                      data-cmd="nav:change" data-tab="dashboard">
                📊 仪表盘
              </button>
              <button class="tab ${activeTab === 'accounts' ? 'active' : ''}"
                      data-cmd="nav:change" data-tab="accounts">
                👥 账号管理
              </button>
              <button class="tab ${activeTab === 'logs' ? 'active' : ''}"
                      data-cmd="nav:change" data-tab="logs">
                📜 请求日志
              </button>
            </nav>
            <div class="tab-actions">
              <button class="btn btn-sm btn-icon" data-cmd="theme:toggle" 
                      title="${theme === 'dark' ? '切换亮色' : '切换暗色'}">
                ${theme === 'dark' ? '🌙' : '☀️'}
              </button>
              <button class="btn btn-sm btn-icon" data-cmd="data:refresh" title="刷新">
                🔄
              </button>
            </div>
          </div>

          <main id="pageContent" data-preserve-children="true"></main>
        </div>
      </div>
    `;
  }

  onMount() {
    this.watch(['activeTab', 'theme', 'user']);
    requestAnimationFrame(() => this._updateTabSlider(false));
  }

  onUpdate() {
    requestAnimationFrame(() => this._updateTabSlider(true));
  }

  _bindEvents() {
    this.delegate('click', '[data-cmd]', (e, target) => {
      const cmd = target.dataset.cmd;
      const tab = target.dataset.tab;
      commands.dispatch(cmd, { tab });
    });

    window.addEventListener('resize', () => {
      this._updateTabSlider(false);
    });
  }

  _updateTabSlider(animate = true) {
    const slider = this.container.querySelector('.tab-slider');
    const activeTab = this.container.querySelector('.tab.active');
    const tabs = this.container.querySelector('.tabs');
    
    if (!slider || !activeTab || !tabs) return;

    const tabLeft = activeTab.offsetLeft;
    const tabWidth = activeTab.offsetWidth;
    const tabsWidth = tabs.scrollWidth;
    const rightValue = tabsWidth - tabLeft - tabWidth;

    if (animate && this._tabSliderInited) {
      slider.style.transition = 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1), right 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    } else {
      slider.style.transition = 'none';
    }

    slider.style.left = `${tabLeft}px`;
    slider.style.right = `${rightValue}px`;

    if (!this._tabSliderInited) {
      slider.offsetHeight;
      this._tabSliderInited = true;
    }
  }
}

export default Shell;
