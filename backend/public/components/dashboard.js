/**
 * 仪表盘组件
 */

import { Component } from '../core/component.js';
import { store } from '../core/store.js';
import { formatNumber } from '../utils/format.js';

export class Dashboard extends Component {
  render() {
    const dashboard = store.get('dashboard') || {};
    const { data, loading } = dashboard;
    
    if (loading && !data) {
      return `
        <div class="loading-placeholder">
          <div class="spinner spinner-lg"></div>
          <span>正在加载...</span>
        </div>
      `;
    }

    const d = data || {};
    const today = d.today || {};
    const accounts = d.accounts || {};
    const pool = d.pool || {};
    const modelUsage = Array.isArray(d.modelUsage) ? d.modelUsage : [];

    return `
      <div class="dashboard-page">
        <div class="stats-grid">
          ${this._renderStatCard('活跃账号', 
            `${accounts.active || 0}<span class="card-value-sub">/ ${accounts.total || 0}</span>`,
            `池中活跃 ${pool.active ?? 0} 个，平均配额 ${(pool.avgQuota ?? 0).toFixed(2)}`
          )}
          ${this._renderStatCard('今日请求',
            formatNumber(today.requests || 0),
            `成功率 ${today.successRate ?? '100'}%`
          )}
          ${this._renderStatCard('今日 Token',
            formatNumber(today.tokens || 0),
            `平均延迟 ${Math.round(today.avgLatency ?? 0)}ms`
          )}
          ${this._renderStatCard('异常账号',
            accounts.error || 0,
            '需要检查的账号',
            accounts.error > 0 ? 'text-danger' : ''
          )}
        </div>

        <div class="content-grid">
          <div class="card">
            <div class="card-header">
              <span class="card-title">模型使用统计（今日）</span>
            </div>
            ${this._renderModelUsage(modelUsage)}
          </div>

          <div class="card">
            <div class="card-header">
              <span class="card-title">API 端点</span>
            </div>
            <div class="endpoint-list">
              ${this._renderEndpoint('OpenAI 兼容', `${location.origin}/v1/chat/completions`)}
              ${this._renderEndpoint('Gemini 原生', `${location.origin}/v1beta/models/{model}:generateContent`)}
              ${this._renderEndpoint('Anthropic 兼容', `${location.origin}/v1/messages`)}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _renderStatCard(title, value, subtitle, valueClass = '') {
    return `
      <div class="card">
        <div class="card-title">${this._escape(title)}</div>
        <div class="card-value ${valueClass}">${value}</div>
        <div class="card-subtitle">${this._escape(subtitle)}</div>
      </div>
    `;
  }

  _renderModelUsage(modelUsage) {
    if (modelUsage.length === 0) {
      return `
        <div class="text-secondary text-center" style="padding:48px 0">
          暂无数据
        </div>
      `;
    }

    return `
      <div class="table-wrapper">
        <table class="table">
          <thead>
            <tr>
              <th>模型</th>
              <th>调用次数</th>
              <th>Token 数</th>
            </tr>
          </thead>
          <tbody>
            ${modelUsage.map(m => `
              <tr>
                <td class="mono" data-label="模型">${this._escape(m.model)}</td>
                <td data-label="调用次数">${formatNumber(m.count)}</td>
                <td data-label="Token 数">${formatNumber(m.tokens)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  _renderEndpoint(label, url) {
    return `
      <div class="endpoint-item">
        <span class="endpoint-label">${this._escape(label)}</span>
        <span class="endpoint-url">${this._escape(url)}</span>
      </div>
    `;
  }

  onMount() {
    this.watch('dashboard');
  }
}

export default Dashboard;
