/**
 * 登录页组件
 */

import { Component } from '../core/component.js';
import { commands } from '../commands/index.js';
import { toast } from '../ui/toast.js';

export class Login extends Component {
  constructor(container) {
    super(container);
    this.state = {
      loading: false
    };
  }

  render() {
    const { loading } = this.state;

    return `
      <div class="login-page">
        <div class="card login-card">
          <div class="login-brand">
            <span class="brand-name">Antigravity Proxy</span>
          </div>
          
          <form id="loginForm">
            <div class="form-group mb-6">
              <label class="form-label">管理密码</label>
              <input id="loginPassword" 
                     type="password" 
                     class="form-input" 
                     placeholder="请输入管理密码" 
                     required 
                     ${loading ? 'disabled' : ''}
                     autocomplete="current-password" />
            </div>
            
            <div class="flex items-center gap-2 mb-6">
              <input id="remember" 
                     type="checkbox" 
                     checked 
                     style="width:auto;accent-color:var(--color-primary)" />
              <span class="text-secondary" style="font-size:13px">保持登录状态</span>
            </div>
            
            <button class="btn btn-primary" 
                    type="submit" 
                    style="width:100%;padding:12px"
                    ${loading ? 'disabled' : ''}>
              ${loading ? '<span class="spinner"></span> 登录中...' : '登 录'}
            </button>
          </form>
        </div>
      </div>
    `;
  }

  onMount() {
    // 自动聚焦密码框
    setTimeout(() => {
      const input = this.container.querySelector('#loginPassword');
      if (input) input.focus();
    }, 100);
  }

  _bindEvents() {
    this.on('#loginForm', 'submit', async (e) => {
      e.preventDefault();
      
      if (this.state.loading) return;

      const password = this.container.querySelector('#loginPassword')?.value;
      const remember = this.container.querySelector('#remember')?.checked ?? true;

      if (!password) {
        toast.error('请输入密码');
        return;
      }

      this.state.loading = true;
      this.update();

      try {
        await commands.dispatch('auth:login', { password, remember });
        
        // 登录成功后会在 app.js 中检测并切换视图
        if (this.props.onSuccess) {
          this.props.onSuccess();
        }
      } catch (error) {
        toast.error(error.message || '登录失败');
      } finally {
        this.state.loading = false;
        this.update();
      }
    });
  }
}

export default Login;