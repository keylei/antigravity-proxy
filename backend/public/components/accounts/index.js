import { Component } from '../../core/component.js';
import { store } from '../../core/store.js';
import { commands } from '../../commands/index.js';
import { formatTime } from '../../utils/format.js';
import { toast } from '../../ui/toast.js';

export class AccountsPage extends Component {
  constructor(container) {
    super(container);
  }

  render() {
    const { list, loading, refreshingAll, selectedIds = [], pinned = null, sortBy = 'default' } = store.get('accounts') || {};
    const accounts = this._sortAccounts(list || [], sortBy);

    const stats = this._calcStats(accounts);
    const selectedCount = selectedIds.length;
    const allSelected = accounts.length > 0 && selectedCount === accounts.length;

    // 计算选中账号的状态分布
    const selectedAccounts = accounts.filter(a => selectedIds.includes(String(a.id)));
    const hasActiveSelected = selectedAccounts.some(a => a.status === 'active');
    const hasDisabledSelected = selectedAccounts.some(a => a.status !== 'active');

    return `
      <div class="accounts-page">
        <div class="stats-grid mb-4">
          ${this._renderStatCard('总账号', stats.total, '全部账号数量')}
          ${this._renderStatCard('活跃', stats.active, '正常运行中', 'text-success')}
          ${this._renderStatCard('禁用', stats.disabled, '手动禁用', 'text-warning')}
          ${this._renderStatCard('异常', stats.error, '需要检查', stats.error > 0 ? 'text-danger' : '')}
        </div>

        <div class="card mb-4">
          <div class="accounts-toolbar">
            <div class="accounts-toolbar-left">
              <span class="text-secondary">共 ${accounts.length} 个账号</span>
              <label class="accounts-sort">
                排序
                <select class="input input-sm" data-action="sort">
                  ${[
                    ['default', '默认（添加时间）'],
                    ['claude-week', 'Claude Weekly 剩余 ↓'],
                    ['claude-5h', 'Claude 5h 剩余 ↓'],
                    ['gemini-week', 'Gemini Weekly 剩余 ↓'],
                    ['gemini-5h', 'Gemini 5h 剩余 ↓'],
                    ['claude-usable', 'Claude 当前可用剩余 ↓'],
                  ].map(([v, t]) => `<option value="${v}" ${sortBy === v ? 'selected' : ''}>${t}</option>`).join('')}
                </select>
              </label>
              ${selectedCount > 0 ? `<span class="selection-count">已选 ${selectedCount} 个</span>` : ''}
              ${accounts.length > 0 ? `
                <button class="btn btn-sm mobile-select-all" data-cmd="accounts:select-all">
                  ${allSelected ? '取消全选' : '全选'}
                </button>
              ` : ''}
            </div>
            <div class="accounts-toolbar-actions">
              ${selectedCount > 0 ? `
                <button class="btn btn-sm btn-danger" data-cmd="accounts:batch-delete">
                  删除 (${selectedCount})
                </button>
                ${hasActiveSelected ? `
                <button class="btn btn-sm btn-warning" data-cmd="accounts:batch-toggle" data-status="disabled">
                  禁用 (${selectedCount})
                </button>
                ` : ''}
                ${hasDisabledSelected ? `
                <button class="btn btn-sm btn-success" data-cmd="accounts:batch-toggle" data-status="active">
                  启用 (${selectedCount})
                </button>
                ` : ''}
                <button class="btn btn-sm" data-cmd="accounts:batch-refresh">
                  刷新 (${selectedCount})
                </button>
                <button class="btn btn-sm" data-cmd="accounts:batch-export">
                  导出 (${selectedCount})
                </button>
                <button class="btn btn-sm" data-cmd="accounts:clear-selection">
                  取消选择
                </button>
              ` : `
                <button class="btn btn-primary btn-sm" data-cmd="oauth:open">
                  + OAuth 添加
                </button>
                <button class="btn btn-sm" data-cmd="import:open">
                  📥 导入
                </button>
                <button class="btn btn-sm" data-cmd="accounts:refresh-all" ${refreshingAll ? 'disabled' : ''}>
                  ${refreshingAll ? '<span class="spinner"></span>' : ''} 刷新全部
                </button>
              `}
            </div>
          </div>
        </div>

        ${this._renderPinnedBanner(pinned, list || [])}

        <div class="card">
          <div class="table-wrapper">
            <table class="table accounts-table">
              <thead>
                <tr>
                  <th style="width:40px">
                    <input type="checkbox"
                           class="account-checkbox"
                           data-action="select-all"
                           ${allSelected ? 'checked' : ''} />
                  </th>
                  <th>邮箱</th>
                  <th>层级</th>
                  <th>配额状态</th>
                  <th>状态</th>
                  <th>最后使用</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                ${this._renderAccountRows(accounts, loading, selectedIds)}
              </tbody>
            </table>
          </div>
        </div>

        ${this._renderOAuthDialog()}
        ${this._renderQuotaDialog()}
        ${this._renderImportDialog()}
      </div>
    `;
  }

  /** 取账号某个额度分组的剩余比例；无数据返回 -1，排序时沉底 */
  _bucketFraction(a, family, window) {
    const buckets = Array.isArray(a.quotaBuckets) ? a.quotaBuckets : [];
    const famRe = family === 'claude' ? /^3p-|claude|gpt/i : /gemini/i;
    const winRe = window === '5h' ? /5h|5-hour|five.hour/i : /weekly|week/i;
    const b = buckets.find(x => famRe.test(`${x.bucketId} ${x.groupId}`) && winRe.test(x.bucketId));
    return b && typeof b.remainingFraction === 'number' ? b.remainingFraction : -1;
  }

  _sortAccounts(accounts, sortBy) {
    if (!sortBy || sortBy === 'default') return accounts;
    const list = [...accounts];
    const statusRank = a => (a.status === 'active' ? 0 : 1);
    let key;
    if (sortBy === 'claude-usable') {
      // 当前真正能用的 Claude 额度 = min(Weekly, 5h)
      key = a => {
        const w = this._bucketFraction(a, 'claude', 'week');
        const h = this._bucketFraction(a, 'claude', '5h');
        if (w < 0) return -1;
        return h < 0 ? w : Math.min(w, h);
      };
    } else {
      const [family, window] = sortBy.split('-');
      key = a => this._bucketFraction(a, family, window === 'week' ? 'week' : '5h');
    }
    // 异常/禁用账号始终排在最后；同额度按 id 稳定排序
    return list.sort((x, y) => statusRank(x) - statusRank(y) || key(y) - key(x) || (x.id - y.id));
  }

  _formatClockShort(ts) {
    if (!ts) return '';
    const d = new Date(Number(ts));
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  _renderPinnedBanner(pinned, accounts) {
    if (!pinned) return '';
    const acc = accounts.find(a => a.id === pinned.id);
    const name = acc ? acc.email : `id=${pinned.id}（已删除）`;
    const strict = pinned.strict !== false;
    const replaced = pinned.replacedFrom
      ? `<div class="pinned-banner-sub">
           ↻ ${this._escape(this._formatClockShort(pinned.replacedAt))} 原指定账号
           <b>${this._escape(pinned.replacedFrom.email || 'id=' + pinned.replacedFrom.id)}</b> 额度用完，已自动换成当前账号
         </div>`
      : '';
    return `
      <div class="card mb-4 pinned-banner">
        <div class="pinned-banner-text">
          📌 已指定账号 <b>${this._escape(name)}</b>：
          ${strict ? '所有请求<b>只用</b>这个账号，它不能用时直接报错' : '<b>优先</b>用这个账号，额度用完时自动换成额度最多的账号'}
          ${acc && acc.status !== 'active' ? '<span class="text-danger">（该账号当前状态异常）</span>' : ''}
          ${replaced}
        </div>
        <div class="pinned-banner-actions">
          <button class="btn btn-sm" data-cmd="accounts:pin-mode" data-status="${strict ? 'prefer' : 'strict'}">
            ${strict ? '改为「优先」' : '改为「仅用」'}
          </button>
          <button class="btn btn-sm btn-warning" data-cmd="accounts:unpin">取消指定</button>
        </div>
      </div>
    `;
  }

  _calcStats(accounts) {
    return {
      total: accounts.length,
      active: accounts.filter(a => a.status === 'active').length,
      disabled: accounts.filter(a => a.status === 'disabled').length,
      error: accounts.filter(a => a.status === 'error').length
    };
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

  _renderAccountRows(accounts, loading, selectedIds) {
    if (loading && accounts.length === 0) {
      return `
        <tr>
          <td colspan="7" class="text-center" style="padding:48px">
            <div class="spinner spinner-lg"></div>
            <div style="margin-top:12px">正在加载...</div>
          </td>
        </tr>
      `;
    }

    if (accounts.length === 0) {
      return `
        <tr>
          <td colspan="7" class="text-center text-secondary" style="padding:48px">
            暂无账号
          </td>
        </tr>
      `;
    }

    return accounts.map(a => this._renderAccountRow(a, selectedIds)).join('');
  }

  _renderAccountRow(a, selectedIds) {
    const status = a.status || 'unknown';
    const isSelected = selectedIds.includes(String(a.id));
    const pinned = store.get('accounts.pinned');
    const isPinned = !!pinned && pinned.id === a.id;

    const statusClass = {
      active: 'status-active',
      disabled: 'status-disabled',
      error: 'status-error'
    }[status] || 'status-unknown';

    const statusText = {
      active: '正常',
      disabled: '禁用',
      error: '异常'
    }[status] || '未知';

    // 层级显示优化
    const tierRaw = (a.tier || '').toLowerCase();
    const tierDisplay = {
      'standard-tier': 'Standard',
      'pay-as-you-go': 'PayG',
      'free-tier': 'Free',
      'enterprise': 'Enterprise'
    }[tierRaw] || (a.tier ? a.tier.replace(/-tier$/i, '') : '-');

    const tierClass = {
      'standard-tier': 'badge-tier-standard',
      'pay-as-you-go': 'badge-tier-payg',
      'free-tier': 'badge-tier-free',
      'enterprise': 'badge-tier-enterprise'
    }[tierRaw] || 'badge-neutral';

    const quota = typeof a.quota_remaining === 'number'
      ? (a.quota_remaining * 100).toFixed(0) + '%'
      : '-';

    const quotaClass = typeof a.quota_remaining === 'number'
      ? (a.quota_remaining < 0.3 ? 'text-danger' : a.quota_remaining < 0.6 ? 'text-warning' : 'text-success')
      : '';

    return `
      <tr class="${isSelected ? 'row-selected' : ''} ${status === 'disabled' ? 'row-disabled' : ''}">
        <td>
          <input type="checkbox"
                 class="account-checkbox"
                 data-action="select"
                 data-id="${a.id}"
                 ${isSelected ? 'checked' : ''} />
        </td>
        <td>
          <div class="account-email-cell">
            <span class="account-email">${this._escape(a.email)}</span>
          </div>
        </td>
        <td>
          <span class="badge ${tierClass}">${this._escape(tierDisplay)}</span>
        </td>
        <td class="quota-status-cell">
          ${this._renderQuotaStatus(a, quota, quotaClass)}
        </td>
        <td>
          <span class="status-indicator ${statusClass}">${statusText}</span>
        </td>
        <td class="mono" style="font-size:12px">
          ${formatTime(a.last_used_at)}
        </td>
        <td>
          <div class="row-actions">
            ${isPinned
              ? `<button class="btn btn-sm btn-icon btn-pinned" title="已指定（点击取消）" data-cmd="accounts:unpin" data-id="${a.id}">📌</button>`
              : `<button class="btn btn-sm btn-icon" title="指定只用此账号" data-cmd="accounts:pin" data-id="${a.id}" data-email="${this._escape(a.email)}">📍</button>`}
            <button class="btn btn-sm btn-icon" title="配额详情" data-cmd="accounts:view-quota" data-id="${a.id}">
              📊
            </button>
            <button class="btn btn-sm btn-icon" title="刷新" data-cmd="accounts:refresh" data-id="${a.id}">
              ↻
            </button>
            <button class="btn btn-sm btn-icon" title="导出" data-cmd="accounts:export" data-id="${a.id}">
              📤
            </button>
            <button class="btn btn-sm btn-icon" title="${status === 'active' ? '禁用' : '启用'}"
                    data-cmd="accounts:toggle-status"
                    data-id="${a.id}"
                    data-status="${status}">
              ${status === 'active' ? '⏸' : '▶'}
            </button>
            <button class="btn btn-sm btn-icon btn-danger" title="删除"
                    data-cmd="accounts:delete"
                    data-id="${a.id}"
                    data-email="${this._escape(a.email)}">
              ✕
            </button>
          </div>
        </td>
      </tr>
    `;
  }

  /**
   * 账号列表中的额度展示：Claude / Gemini 两列，每列 5h 与 Weekly 两条进度条，下方为 AI 积分
   * 数据来自 retrieveUserQuotaSummary（分组 bucketId: 3p-5h / 3p-weekly / gemini-5h / gemini-weekly）
   */
  _renderQuotaStatus(a, fallbackText, fallbackClass) {
    const buckets = Array.isArray(a.quotaBuckets) ? a.quotaBuckets : [];
    if (buckets.length === 0) {
      return `<span class="quota-value ${fallbackClass}">${fallbackText}</span>
              <div class="quota-hint">暂无 5h / Weekly 数据，点刷新同步</div>`;
    }

    const families = [
      { key: 'claude', title: 'Claude', match: b => /^3p-|claude|gpt/i.test(`${b.bucketId} ${b.groupId}`) },
      { key: 'gemini', title: 'Gemini', match: b => /gemini/i.test(`${b.bucketId} ${b.groupId}`) }
    ];
    const windows = [
      { label: '5h', match: id => /5h|5-hour|five.hour/i.test(id) },
      { label: 'Weekly', match: id => /weekly|week/i.test(id) }
    ];

    const columns = families.map(family => {
      const own = buckets.filter(family.match);
      const rows = windows.map(w => {
        const bucket = own.find(b => w.match(b.bucketId));
        return this._renderQuotaBar(w.label, bucket);
      }).join('');
      return `
        <div class="quota-family">
          <div class="quota-family-title">${family.title}</div>
          ${rows}
        </div>
      `;
    }).join('');

    return `
      <div class="quota-families">${columns}</div>
      ${this._renderCredits(a.aiCredits)}
    `;
  }

  _renderQuotaBar(label, bucket) {
    if (!bucket || typeof bucket.remainingFraction !== 'number') {
      return `
        <div class="quota-line">
          <div class="quota-line-head"><span>${label}</span><span class="text-secondary">-</span></div>
          <div class="quota-bar"><span class="quota-bar-fill unknown" style="width:0%"></span></div>
        </div>
      `;
    }
    const fraction = Math.max(0, Math.min(1, bucket.remainingFraction));
    const percent = Math.round(fraction * 100);
    const level = fraction < 0.3 ? 'danger' : fraction < 0.6 ? 'warn' : 'good';
    const textClass = fraction < 0.3 ? 'text-danger' : fraction < 0.6 ? 'text-warning' : 'text-success';
    return `
      <div class="quota-line">
        <div class="quota-line-head">
          <span>${label}</span>
          <span class="quota-line-percent ${textClass}">${percent}%</span>
        </div>
        <div class="quota-bar"><span class="quota-bar-fill ${level}" style="width:${percent}%"></span></div>
        <div class="quota-line-reset mono">${this._formatResetIn(bucket.resetTime)}</div>
      </div>
    `;
  }

  /** 例：6d 5h 14m (11/10 02:31) */
  _formatResetIn(resetTime) {
    if (!resetTime) return '-';
    const target = new Date(Number(resetTime));
    if (isNaN(target.getTime())) return '-';
    let diffMin = Math.max(0, Math.round((target.getTime() - Date.now()) / 60000));
    const days = Math.floor(diffMin / 1440); diffMin -= days * 1440;
    const hours = Math.floor(diffMin / 60);
    const minutes = diffMin - hours * 60;
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes || parts.length === 0) parts.push(`${minutes}m`);
    const pad = n => String(n).padStart(2, '0');
    const stamp = `${pad(target.getMonth() + 1)}/${pad(target.getDate())} ${pad(target.getHours())}:${pad(target.getMinutes())}`;
    return `${parts.join(' ')} (${stamp})`;
  }

  _renderCredits(credits) {
    let value = '-';
    if (Array.isArray(credits)) {
      const amounts = credits
        .map(c => Number(c.creditAmount))
        .filter(n => Number.isFinite(n));
      // 上游未返回 creditAmount 时余额未知，显示 '-' 而不是 0
      value = amounts.length > 0 ? amounts.reduce((s, n) => s + n, 0).toLocaleString('zh-CN') : '-';
    }
    return `<div class="quota-credits">可用 AI 积分: <span class="mono">${this._escape(value)}</span></div>`;
  }

  _renderOAuthDialog() {
    const oauth = store.get('dialogs.oauth') || {};
    const { port } = oauth;

    return `
      <dialog id="oauthDialog">
        <div class="dialog-header">
          <div class="dialog-title">OAuth 添加账号</div>
          <div class="dialog-subtitle">通过 Google 授权添加 Gemini API 账号</div>
        </div>
        <div class="dialog-body">
          <div class="flex gap-3 items-center mb-4"
               style="padding:16px; background:var(--color-surface-2); border-radius:var(--radius-md)">
            <button class="btn btn-primary" data-cmd="oauth:start">
              1. 打开授权页面
            </button>
            <span class="text-secondary" style="font-size:12px">
              端口：<code class="font-mono">${port || '-'}</code>
            </span>
          </div>
          <div class="form-group">
            <label class="form-label">
              2. 粘贴浏览器地址栏的回调 URL（即使页面打不开也没关系）
            </label>
            <textarea id="oauthCallback"
                      class="form-textarea"
                      placeholder="http://localhost:xxxxx/oauth-callback?code=..."></textarea>
          </div>
        </div>
        <div class="dialog-footer">
          <button class="btn" data-cmd="oauth:close">取消</button>
          <button class="btn btn-primary" data-action="oauth-exchange">交换并创建账号</button>
        </div>
      </dialog>
    `;
  }

  _renderQuotaDialog() {
    const quota = store.get('dialogs.quota') || {};
    const { account, data, loading } = quota;

    let content = '';
    if (loading) {
      content = `
        <div class="loading-placeholder">
          <div class="spinner spinner-lg"></div>
          <span>正在加载配额数据...</span>
        </div>
      `;
    } else if (data) {
      const quotaData = data?.data || data;
      const quotas = quotaData?.quotas || {};
      const modelSupport = quotaData?.modelSupport || {};
      const supportRows = [
        ['Claude Opus 4.6', 'claude-opus-4-6'],
        ['Claude Sonnet 4.6', 'claude-sonnet-4-6']
      ].map(([label, modelId]) => {
        const state = modelSupport[modelId];
        const text = state?.status === 'verified'
          ? (state.supported ? '支持' : '不支持')
          : '未验证';
        return `<tr><td>${label}</td><td class="${state?.supported ? 'text-success' : ''}">${text}</td></tr>`;
      }).join('');
      const groups = Array.isArray(quotaData?.quotaGroups) ? quotaData.quotaGroups : [];
      const statusText = quotaData?.quotaSummaryStatus === 'verified'
        ? '上游实时数据'
        : quotaData?.quotaSummaryStatus === 'stale' ? '上次成功数据' : '无数据';
      const supportTable = `
        <div class="quota-section">
          <div class="quota-section-heading">模型可用性 <span class="text-secondary">按账号验证</span></div>
          <table class="table"><thead><tr><th>模型</th><th>状态</th></tr></thead><tbody>${supportRows}</tbody></table>
        </div>
      `;
      const bucketGroups = groups.map(group => {
        const bucketRows = (group.buckets || []).map(bucket => {
          const fraction = typeof bucket.remainingFraction === 'number' ? bucket.remainingFraction : null;
          const percent = fraction === null ? '无数据' : `${(Math.max(0, Math.min(1, fraction)) * 100).toFixed(2)}%`;
          const windowName = /5h|5-hour|five.hour/i.test(`${bucket.bucketId} ${bucket.window || ''}`)
            ? '5 小时' : /weekly|week/i.test(`${bucket.bucketId} ${bucket.window || ''}`) ? '周' : bucket.bucketId;
          return `<tr><td>${this._escape(windowName)}</td><td>${this._escape(percent)}</td><td class="quota-reset mono">${formatTime(bucket.resetTime)}</td></tr>`;
        }).join('');
        return `<div class="quota-section"><div class="quota-section-heading">${this._escape(group.displayName)}</div><table class="table"><thead><tr><th>周期</th><th>剩余额度</th><th>重置时间</th></tr></thead><tbody>${bucketRows || '<tr><td colspan="3">无数据</td></tr>'}</tbody></table></div>`;
      }).join('');
      const groupedQuotaContent = `
        <div class="quota-section-heading">Claude / Gemini 专用额度 <span class="text-secondary">${statusText}</span></div>
        ${bucketGroups || '<div class="text-secondary quota-empty">无数据</div>'}
      `;
      const overallQuota = typeof quotaData?.overallQuota === 'number' && Number.isFinite(quotaData.overallQuota)
        ? Math.max(0, Math.min(1, quotaData.overallQuota))
        : null;
      const overallText = overallQuota === null ? '-' : `${(overallQuota * 100).toFixed(2)}%`;
      const overallReset = this._escape(formatTime(quotaData?.resetTime));
      const overallColorClass = overallQuota === null ? ''
        : (overallQuota < 0.3 ? 'text-danger' : overallQuota < 0.6 ? 'text-warning' : 'text-success');

      const summary = `
        <div class="quota-summary">
          <div class="quota-card">
            <div class="quota-card-label">总体剩余</div>
            <div class="quota-card-value ${overallColorClass}">${this._escape(overallText)}</div>
          </div>
          <div class="quota-card">
            <div class="quota-card-label">最近重置</div>
            <div class="quota-card-value quota-card-value--mono">${overallReset}</div>
          </div>
        </div>
      `;

      if (Object.keys(quotas).length === 0) {
        content = `
          ${supportTable}
          ${groupedQuotaContent}
          ${summary}
          <div class="text-center text-secondary quota-empty">无普通模型配额数据</div>
        `;
      } else {
        const rows = Object.entries(quotas).map(([modelId, info]) => {
          const remaining = typeof info?.remainingFraction === 'number' && Number.isFinite(info.remainingFraction)
            ? Math.max(0, Math.min(1, info.remainingFraction))
            : null;
          const percent = remaining === null ? null : remaining * 100;
          const percentText = percent === null ? '未知' : `${percent.toFixed(2)}%`;
          const barWidth = percent === null ? 0 : Math.max(0, Math.min(100, percent));
          const barClass = remaining === null ? 'unknown' : (remaining < 0.2 ? 'danger' : (remaining < 0.5 ? 'warn' : 'good'));
          const displayName = info?.displayName || modelId;

          return `
            <tr>
              <td>
                <div class="quota-model">
                  <div class="quota-model-name">${this._escape(displayName)}</div>
                  <div class="quota-model-id mono">${this._escape(modelId)}</div>
                </div>
              </td>
              <td>
                <div class="quota-meter">
                  <div class="quota-meter-header">
                    <span class="quota-percent">${this._escape(percentText)}</span>
                    ${remaining === null ? '' : `<span class="quota-fraction mono">${remaining.toFixed(4)}</span>`}
                  </div>
                  <div class="quota-bar">
                    <span class="quota-bar-fill ${barClass}" style="width:${barWidth}%"></span>
                  </div>
                </div>
              </td>
              <td class="quota-reset mono">${formatTime(info?.resetTime)}</td>
            </tr>
          `;
        }).join('');

        content = `
          ${supportTable}
          ${groupedQuotaContent}
          ${summary}
          <div class="table-wrapper quota-table">
            <table class="table">
              <thead>
                <tr>
                  <th>模型</th>
                  <th>剩余额度</th>
                  <th>重置时间</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        `;
      }
    } else {
      content = '<div class="text-center text-secondary" style="padding:48px">无配额数据</div>';
    }

    return `
      <dialog id="quotaDialog" class="quota-dialog">
        <div class="dialog-header">
          <div class="dialog-title">配额详情</div>
          <div class="dialog-subtitle">${this._escape(account?.email || '')}</div>
        </div>
        <div class="dialog-body">
          ${this._renderRefreshTokenRow(data)}
          ${content}
        </div>
        <div class="dialog-footer">
          <button class="btn" data-cmd="accounts:close-quota">关闭</button>
        </div>
      </dialog>
    `;
  }

  /** 配额详情顶部的 refresh_token 行：默认打码，可显示 / 复制 */
  _renderRefreshTokenRow(data) {
    const token = (data?.data || data)?.refreshToken;
    if (!token) return '';
    const masked = token.length > 16 ? `${token.slice(0, 8)}…${token.slice(-6)}` : '••••••••';
    return `
      <div class="quota-section refresh-token-section">
        <div class="quota-section-heading">Refresh Token</div>
        <div class="refresh-token-row">
          <code class="refresh-token-value mono" data-masked="${this._escape(masked)}" data-full="${this._escape(token)}">${this._escape(masked)}</code>
          <button class="btn btn-sm" data-action="token-toggle">显示</button>
          <button class="btn btn-sm" data-action="token-copy">复制</button>
        </div>
      </div>
    `;
  }

  _renderImportDialog() {
    const importDialog = store.get('dialogs.import') || {};
    const { tab = 'manual' } = importDialog;

    return `
      <dialog id="importDialog" class="import-dialog">
        <div class="dialog-header">
          <div class="dialog-title">导入账号</div>
          <div class="dialog-subtitle">手动输入或从文件导入</div>
        </div>
        <div class="dialog-body">
          <div class="import-tabs">
            <button class="import-tab ${tab === 'manual' ? 'active' : ''}" data-action="import-tab" data-tab="manual">
              手动输入
            </button>
            <button class="import-tab ${tab === 'file' ? 'active' : ''}" data-action="import-tab" data-tab="file">
              文件导入
            </button>
          </div>

          <div class="import-content">
            ${tab === 'manual' ? this._renderManualImportForm() : this._renderFileImportForm()}
          </div>
        </div>
        <div class="dialog-footer">
          <button class="btn" data-cmd="import:close">取消</button>
          ${tab === 'manual' ? '<button class="btn btn-primary" data-action="import-manual-submit">添加账号</button>' : ''}
        </div>
      </dialog>
    `;
  }

  _renderManualImportForm() {
    return `
      <form id="manualImportForm" class="import-form">
        <div class="form-group">
          <label class="form-label">Email <span class="text-secondary">(可选，留空自动获取)</span></label>
          <input id="importEmail" class="form-input" placeholder="user@gmail.com" />
        </div>
        <div class="form-group">
          <label class="form-label">Refresh Token <span class="text-danger">*</span></label>
          <input id="importRefreshToken" class="form-input font-mono" placeholder="1//..." required />
        </div>
        <div class="form-group">
          <label class="form-label">Project ID <span class="text-secondary">(可选)</span></label>
          <input id="importProjectId" class="form-input font-mono" placeholder="可选，留空会自动获取" />
        </div>
      </form>
    `;
  }

  _renderFileImportForm() {
    return `
      <div class="file-import-zone" id="fileDropZone">
        <div class="file-import-icon">📁</div>
        <div class="file-import-text">拖拽 JSON 文件到此处</div>
        <div class="file-import-or">或</div>
        <button class="btn btn-primary" data-action="import-file-select">选择文件</button>
        <input type="file" id="importFileInput" accept=".json" style="display:none" />
        <div class="file-import-hint">
          支持格式：[{"refresh_token":"...","email":"...(可选)","project_id":"...(可选)"}]
        </div>
      </div>
    `;
  }

  onMount() {
    this.watch(['accounts', 'dialogs.oauth', 'dialogs.quota', 'dialogs.import']);
    // 每 5 秒只拉一次设置：后端额度用完自动换号后，横幅与 📌 及时跟上（变化时才整表刷新）
    this._autoRefreshTimer = setInterval(() => {
      if (document.hidden) return;
      if (!store.get('accounts.pinned')) return;
      commands.dispatch('accounts:sync-pinned').catch(() => {});
    }, 5000);
  }

  onUnmount() {
    if (this._autoRefreshTimer) clearInterval(this._autoRefreshTimer);
    this._autoRefreshTimer = null;
  }

  onUpdate() {
    this._syncDialogState('oauthDialog', store.get('dialogs.oauth.open'));
    this._syncDialogState('quotaDialog', store.get('dialogs.quota.open'));
    this._syncDialogState('importDialog', store.get('dialogs.import.open'));
  }

  _syncDialogState(dialogId, shouldBeOpen) {
    const dialog = this.container.querySelector(`#${dialogId}`);
    if (!dialog) return;

    if (shouldBeOpen && !dialog.open) {
      dialog.showModal();
    } else if (!shouldBeOpen && dialog.open) {
      dialog.close();
    }
  }

  _bindEvents() {
    // 命令按钮点击
    this.delegate('click', '[data-cmd]', (e, target) => {
      const cmd = target.dataset.cmd;
      const id = target.dataset.id;
      const status = target.dataset.status;
      const email = target.dataset.email;

      if (cmd === 'accounts:batch-toggle') {
        commands.dispatch(cmd, { newStatus: status });
      } else {
        commands.dispatch(cmd, { id, currentStatus: status, email });
      }
    });

    // 恢复上次的排序选择
    try {
      const saved = localStorage.getItem('accounts.sortBy');
      if (saved && store.get('accounts.sortBy') === undefined) store.set('accounts.sortBy', saved);
    } catch { /* ignore */ }

    // 排序方式（记住选择）
    this.delegate('change', '[data-action="sort"]', (e, target) => {
      const v = target.value || 'default';
      try { localStorage.setItem('accounts.sortBy', v); } catch { /* ignore */ }
      store.set('accounts.sortBy', v);
    });

    // 复选框 - 全选
    this.delegate('change', '[data-action="select-all"]', () => {
      commands.dispatch('accounts:select-all');
    });

    // 复选框 - 单选
    this.delegate('change', '[data-action="select"]', (e, target) => {
      const id = target.dataset.id;
      commands.dispatch('accounts:select', { id });
    });

    this.on('[data-action="oauth-exchange"]', 'click', async () => {
      const callbackUrl = this.container.querySelector('#oauthCallback')?.value || '';

      if (!callbackUrl) {
        toast.error('请粘贴回调URL');
        return;
      }

      try {
        await commands.dispatch('oauth:exchange', { callbackUrl });
      } catch (error) {
        toast.error(error.message);
      }
    });

    this.delegate('click', '[data-action="token-toggle"]', (e, target) => {
      const code = target.parentElement.querySelector('.refresh-token-value');
      const showing = code.dataset.showing === '1';
      code.textContent = showing ? code.dataset.masked : code.dataset.full;
      code.dataset.showing = showing ? '0' : '1';
      target.textContent = showing ? '显示' : '隐藏';
    });

    this.delegate('click', '[data-action="token-copy"]', async (e, target) => {
      const code = target.parentElement.querySelector('.refresh-token-value');
      try {
        await navigator.clipboard.writeText(code.dataset.full);
        toast.success('Refresh Token 已复制');
      } catch {
        // 非安全上下文下 clipboard API 不可用，退回 execCommand
        const ta = document.createElement('textarea');
        ta.value = code.dataset.full;
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        ok ? toast.success('Refresh Token 已复制') : toast.error('复制失败，请点「显示」后手动复制');
      }
    });

    this.delegate('click', '[data-action="import-tab"]', (e, target) => {
      const tab = target.dataset.tab;
      store.set('dialogs.import.tab', tab);
    });

    this.on('[data-action="import-manual-submit"]', 'click', async () => {
      const email = this.container.querySelector('#importEmail')?.value?.trim() || null;
      const refreshToken = this.container.querySelector('#importRefreshToken')?.value?.trim();
      const projectId = this.container.querySelector('#importProjectId')?.value?.trim() || null;

      if (!refreshToken) {
        toast.error('请填写 Refresh Token');
        return;
      }

      try {
        await commands.dispatch('accounts:create', { email, refreshToken, projectId });
        store.set('dialogs.import.open', false);
      } catch (error) {
        toast.error(error.message);
      }
    });

    this.on('[data-action="import-file-select"]', 'click', () => {
      this.container.querySelector('#importFileInput')?.click();
    });

    this.on('#importFileInput', 'change', async (e) => {
      const file = e.target.files?.[0];
      if (file) {
        await this._handleFileImport(file);
      }
    });

    this.on('#fileDropZone', 'dragover', (e) => {
      e.preventDefault();
      e.currentTarget.classList.add('drag-over');
    });

    this.on('#fileDropZone', 'dragleave', (e) => {
      e.currentTarget.classList.remove('drag-over');
    });

    this.on('#fileDropZone', 'drop', async (e) => {
      e.preventDefault();
      e.currentTarget.classList.remove('drag-over');
      const file = e.dataTransfer?.files?.[0];
      if (file && file.name.endsWith('.json')) {
        await this._handleFileImport(file);
      } else {
        toast.error('请选择 JSON 文件');
      }
    });

    this.on('dialog', 'click', (e) => {
      if (e.target.tagName === 'DIALOG') {
        const dialogId = e.target.id;
        if (dialogId === 'oauthDialog') {
          commands.dispatch('oauth:close');
        } else if (dialogId === 'quotaDialog') {
          commands.dispatch('accounts:close-quota');
        } else if (dialogId === 'importDialog') {
          commands.dispatch('import:close');
        }
      }
    });

    this.on('dialog', 'cancel', (e) => {
      e.preventDefault();
      const dialogId = e.target.id;
      if (dialogId === 'oauthDialog') {
        commands.dispatch('oauth:close');
      } else if (dialogId === 'quotaDialog') {
        commands.dispatch('accounts:close-quota');
      } else if (dialogId === 'importDialog') {
        commands.dispatch('import:close');
      }
    });
  }

  async _handleFileImport(file) {
    const loading = toast.loading('正在导入...');

    try {
      const text = await file.text();
      let data;

      try {
        data = JSON.parse(text);
      } catch {
        loading.update('JSON 格式错误', 'error');
        setTimeout(() => loading.close(), 2000);
        return;
      }

      let accounts;
      if (Array.isArray(data)) {
        accounts = data;
      } else if (data.accounts && Array.isArray(data.accounts)) {
        accounts = data.accounts;
      } else if (data.refresh_token) {
        accounts = [data];
      } else {
        accounts = [];
      }

      if (accounts.length === 0) {
        loading.update('未找到有效账号数据', 'warning');
        setTimeout(() => loading.close(), 2000);
        return;
      }

      const validAccounts = accounts.filter(a => a.refresh_token).map(a => ({
        email: a.email || null,
        refresh_token: a.refresh_token,
        project_id: a.project_id || null
      }));

      if (validAccounts.length === 0) {
        loading.update('未找到包含 refresh_token 的账号', 'warning');
        setTimeout(() => loading.close(), 2000);
        return;
      }

      const result = await commands.dispatch('accounts:import-batch', { accounts: validAccounts });
      const results = result?.results || [];
      const successCount = results.filter(r => r.success).length;
      const failCount = results.length - successCount;
      const withProjectId = results.filter(r => r.success && r.project_id).length;
      const withoutProjectId = successCount - withProjectId;

      loading.close();

      if (failCount > 0) {
        // 获取失败的错误信息
        const failedResults = results.filter(r => !r.success);
        const errorMessages = failedResults.map(r => r.error || '未知错误');
        const uniqueErrors = [...new Set(errorMessages)];
        const errorSummary = uniqueErrors.slice(0, 3).join('；');
        toast.warning(`导入完成：${successCount} 成功，${failCount} 失败（${errorSummary}）`);
      } else if (withoutProjectId > 0) {
        toast.warning(`已导入 ${successCount} 个账号，但 ${withoutProjectId} 个未获取 project id（可能无法使用）`);
      } else {
        toast.success(`已导入 ${successCount} 个账号，全部成功获取 project id`);
      }

      store.set('dialogs.import.open', false);
      await commands.dispatch('accounts:load', { silent: true });
    } catch (error) {
      loading.close();
      toast.error(error.message || '导入失败');
    }
  }
}

export default AccountsPage;
