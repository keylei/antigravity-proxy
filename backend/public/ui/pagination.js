/**
 * 分页组件
 * 提供完整的分页功能：页码导航、每页条数、快速跳转
 */

import { Component } from '../core/component.js';

export class Pagination extends Component {
  constructor(container, props = {}) {
    super(container, {
      page: 1,
      pageSize: 50,
      total: 0,
      pageSizeOptions: [20, 50, 100],
      onChange: () => {},
      onPageSizeChange: () => {},
      ...props
    });
  }

  render() {
    const { page, pageSize, total, pageSizeOptions } = this.props;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, total);

    return `
      <div class="pagination">
        <div class="pagination-info">
          ${total > 0 ? `显示 ${start}-${end} 条，共 ${total} 条` : '暂无数据'}
        </div>
        
        <div class="pagination-controls">
          <button class="btn btn-sm btn-icon" data-action="first" 
                  ${page <= 1 ? 'disabled' : ''} title="第一页">
            ⏮
          </button>
          <button class="btn btn-sm btn-icon" data-action="prev" 
                  ${page <= 1 ? 'disabled' : ''} title="上一页">
            ‹
          </button>
          
          <span class="pagination-pages">
            ${this._renderPageNumbers(page, totalPages)}
          </span>
          
          <button class="btn btn-sm btn-icon" data-action="next" 
                  ${page >= totalPages ? 'disabled' : ''} title="下一页">
            ›
          </button>
          <button class="btn btn-sm btn-icon" data-action="last" 
                  ${page >= totalPages ? 'disabled' : ''} title="最后一页">
            ⏭
          </button>
        </div>
        
        <div class="pagination-size">
          <span>每页</span>
          <select class="form-select form-select-sm" data-action="size">
            ${pageSizeOptions.map(size => `
              <option value="${size}" ${size === pageSize ? 'selected' : ''}>${size}</option>
            `).join('')}
          </select>
          <span>条</span>
        </div>
        
        <div class="pagination-jump">
          <span>跳转</span>
          <input type="number" 
                 class="form-input form-input-sm" 
                 min="1" 
                 max="${totalPages}" 
                 value="${page}"
                 data-action="jump" 
                 style="width:60px" />
          <span>/ ${totalPages} 页</span>
        </div>
      </div>
    `;
  }

  /**
   * 渲染页码按钮
   * @private
   */
  _renderPageNumbers(current, total) {
    if (total <= 1) return '';
    
    const pages = [];
    const delta = 2; // 当前页前后显示的页数

    // 始终显示第一页
    pages.push(1);

    // 计算中间页码范围
    const rangeStart = Math.max(2, current - delta);
    const rangeEnd = Math.min(total - 1, current + delta);

    // 添加省略号（如果需要）
    if (rangeStart > 2) {
      pages.push('...');
    }

    // 添加中间页码
    for (let i = rangeStart; i <= rangeEnd; i++) {
      pages.push(i);
    }

    // 添加省略号（如果需要）
    if (rangeEnd < total - 1) {
      pages.push('...');
    }

    // 始终显示最后一页
    if (total > 1) {
      pages.push(total);
    }

    return pages.map(p => {
      if (p === '...') {
        return '<span class="pagination-ellipsis">…</span>';
      }
      const isActive = p === current;
      return `
        <button class="btn btn-sm ${isActive ? 'btn-primary' : ''}" 
                data-action="goto" 
                data-page="${p}"
                ${isActive ? 'disabled' : ''}>
          ${p}
        </button>
      `;
    }).join('');
  }

  _bindEvents() {
    // 页码按钮点击
    this.delegate('click', '[data-action]', (e, target) => {
      if (target.disabled) return;
      
      const action = target.dataset.action;
      const { page, pageSize, total, onChange } = this.props;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));

      switch (action) {
        case 'first':
          onChange(1);
          break;
        case 'prev':
          if (page > 1) onChange(page - 1);
          break;
        case 'next':
          if (page < totalPages) onChange(page + 1);
          break;
        case 'last':
          onChange(totalPages);
          break;
        case 'goto':
          const targetPage = Number(target.dataset.page);
          if (targetPage !== page) onChange(targetPage);
          break;
      }
    });

    // 每页条数变化
    this.on('[data-action="size"]', 'change', (e) => {
      const newSize = Number(e.target.value);
      this.props.onPageSizeChange(newSize);
    });

    // 快速跳转
    this.on('[data-action="jump"]', 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const { pageSize, total, onChange } = this.props;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        let targetPage = Number(e.target.value);
        
        // 边界处理
        targetPage = Math.max(1, Math.min(targetPage, totalPages));
        
        if (!isNaN(targetPage)) {
          onChange(targetPage);
        }
      }
    });

    // 失焦时验证输入
    this.on('[data-action="jump"]', 'blur', (e) => {
      const { page, pageSize, total } = this.props;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      let value = Number(e.target.value);
      
      if (isNaN(value) || value < 1) {
        e.target.value = page;
      } else if (value > totalPages) {
        e.target.value = totalPages;
      }
    });
  }

  /**
   * 更新属性并重新渲染
   */
  setProps(newProps) {
    this.props = { ...this.props, ...newProps };
    this.update();
  }
}

export default Pagination;