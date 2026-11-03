/**
 * 下拉选择组件
 * 支持搜索过滤、清除选择、键盘导航
 */

import { Component } from '../core/component.js';

export class Dropdown extends Component {
  constructor(container, props = {}) {
    super(container, {
      options: [],        // [{ value, label }]
      value: '',
      placeholder: '请选择...',
      searchable: true,
      clearable: true,
      disabled: false,
      onChange: () => {},
      ...props
    });

    this.state = {
      open: false,
      search: '',
      highlightIndex: -1
    };

    this._documentClickHandler = null;
  }

  render() {
    const { options, value, placeholder, searchable, clearable, disabled } = this.props;
    const { open, search, highlightIndex } = this.state;

    // 过滤选项
    const filtered = searchable && search
      ? options.filter(o => 
          o.label.toLowerCase().includes(search.toLowerCase()) ||
          String(o.value).toLowerCase().includes(search.toLowerCase())
        )
      : options;

    const selected = options.find(o => o.value === value);

    return `
      <div class="dropdown ${open ? 'open' : ''} ${disabled ? 'disabled' : ''}">
        <button class="dropdown-trigger" 
                data-action="toggle" 
                type="button"
                ${disabled ? 'disabled' : ''}
                aria-haspopup="listbox"
                aria-expanded="${open}">
          <span class="dropdown-value ${!selected ? 'placeholder' : ''}">
            ${selected ? this._escape(selected.label) : placeholder}
          </span>
          ${clearable && value ? `
            <span class="dropdown-clear" data-action="clear" title="清除">✕</span>
          ` : ''}
          <span class="dropdown-arrow">▾</span>
        </button>
        
        ${open ? `
          <div class="dropdown-menu" role="listbox">
            ${searchable ? `
              <div class="dropdown-search">
                <input type="text" 
                       class="form-input" 
                       placeholder="搜索..." 
                       value="${this._escape(search)}"
                       data-action="search"
                       autocomplete="off" />
              </div>
            ` : ''}
            
            <div class="dropdown-options">
              ${filtered.length === 0 ? `
                <div class="dropdown-empty">无匹配结果</div>
              ` : filtered.map((o, index) => `
                <div class="dropdown-option ${o.value === value ? 'selected' : ''} ${index === highlightIndex ? 'highlighted' : ''}" 
                     data-action="select"
                     data-value="${this._escape(String(o.value))}"
                     data-index="${index}"
                     role="option"
                     aria-selected="${o.value === value}">
                  ${this._escape(o.label)}
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  onMount() {
    // 全局点击关闭
    this._documentClickHandler = (e) => {
      if (this.state.open && !this.container.contains(e.target)) {
        this._close();
      }
    };
    document.addEventListener('click', this._documentClickHandler);
  }

  onUnmount() {
    if (this._documentClickHandler) {
      document.removeEventListener('click', this._documentClickHandler);
    }
  }

  _bindEvents() {
    // 切换下拉
    this.on('[data-action="toggle"]', 'click', (e) => {
      e.stopPropagation();
      if (this.props.disabled) return;
      
      if (this.state.open) {
        this._close();
      } else {
        this._open();
      }
    });

    // 清除选择
    this.delegate('click', '[data-action="clear"]', (e) => {
      e.stopPropagation();
      this.props.onChange('');
      this._close();
    });

    // 搜索输入
    this.on('[data-action="search"]', 'input', (e) => {
      this.state.search = e.target.value;
      this.state.highlightIndex = 0;
      this.update();
      
      // 保持搜索框焦点
      requestAnimationFrame(() => {
        const input = this.container.querySelector('[data-action="search"]');
        if (input) {
          input.focus();
          input.selectionStart = input.selectionEnd = input.value.length;
        }
      });
    });

    // 选择选项
    this.delegate('click', '[data-action="select"]', (e, target) => {
      const value = target.dataset.value;
      this.props.onChange(value);
      this._close();
    });

    // 键盘导航
    this.container.addEventListener('keydown', (e) => {
      if (!this.state.open) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
          e.preventDefault();
          this._open();
        }
        return;
      }

      const { options } = this.props;
      const { search, highlightIndex } = this.state;
      
      const filtered = this.props.searchable && search
        ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
        : options;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          this.state.highlightIndex = Math.min(highlightIndex + 1, filtered.length - 1);
          this.update();
          this._scrollToHighlighted();
          break;

        case 'ArrowUp':
          e.preventDefault();
          this.state.highlightIndex = Math.max(highlightIndex - 1, 0);
          this.update();
          this._scrollToHighlighted();
          break;

        case 'Enter':
          e.preventDefault();
          if (highlightIndex >= 0 && highlightIndex < filtered.length) {
            this.props.onChange(String(filtered[highlightIndex].value));
            this._close();
          }
          break;

        case 'Escape':
          e.preventDefault();
          this._close();
          break;
      }
    });
  }

  /**
   * 打开下拉
   */
  _open() {
    this.state.open = true;
    this.state.search = '';
    this.state.highlightIndex = this._getSelectedIndex();
    this.update();

    // 聚焦搜索框
    requestAnimationFrame(() => {
      const input = this.container.querySelector('[data-action="search"]');
      if (input) input.focus();
    });
  }

  /**
   * 关闭下拉
   */
  _close() {
    this.state.open = false;
    this.state.search = '';
    this.state.highlightIndex = -1;
    this.update();
  }

  /**
   * 获取当前选中项的索引
   */
  _getSelectedIndex() {
    const { options, value } = this.props;
    return options.findIndex(o => o.value === value);
  }

  /**
   * 滚动到高亮项
   */
  _scrollToHighlighted() {
    const highlighted = this.container.querySelector('.dropdown-option.highlighted');
    if (highlighted) {
      highlighted.scrollIntoView({ block: 'nearest' });
    }
  }

  /**
   * 更新属性
   */
  setProps(newProps) {
    this.props = { ...this.props, ...newProps };
    this.update();
  }

  /**
   * 设置选项
   */
  setOptions(options) {
    this.props.options = options;
    this.update();
  }

  /**
   * 设置值
   */
  setValue(value) {
    this.props.value = value;
    this.update();
  }
}

export default Dropdown;