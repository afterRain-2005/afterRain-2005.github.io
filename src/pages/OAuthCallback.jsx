import { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { BangumiAuthService, GitHubAuthService, StorageService } from '../services/api';
import { Loader2, CheckCircle, XCircle, Download } from 'lucide-react';
import './OAuthCallback.css';

const API_BASE = 'https://anispace-oauth-proxy.lyw2373314970.workers.dev';

export default function OAuthCallback() {
  const navigate = useNavigate();
  const location = useLocation();
  const { oauthLogin } = useApp();
  const [status, setStatus] = useState('loading'); // loading | success | error | importing
  const [errorMsg, setErrorMsg] = useState('');
  const [importResult, setImportResult] = useState(null);
  const executedRef = useRef(false);

  useEffect(() => {
    // 防止 StrictMode 双渲染或依赖变化导致重复执行
    // OAuth code 只能用一次，重复发送必然失败
    if (executedRef.current) return;
    executedRef.current = true;

    // 从 React Router location 或 sessionStorage（SPA redirect fallback）获取参数
    let params = new URLSearchParams(location.search);
    let pathname = location.pathname;

    // Fallback: 如果 location.search 为空，尝试从 sessionStorage 恢复
    if (!params.get('code')) {
      const saved = sessionStorage.getItem('spa_redirect');
      if (saved) {
        sessionStorage.removeItem('spa_redirect');
        try {
          const savedUrl = new URL(saved, window.location.origin);
          params = new URLSearchParams(savedUrl.search);
          pathname = savedUrl.pathname;
        } catch {}
      }
    }

    const code = params.get('code');
    const error = params.get('error');
    const state = params.get('state');

    // Determine provider from path
    const provider = pathname.includes('github') ? 'github' : 'bangumi';

    // H-1: 验证 OAuth state 参数，防止 CSRF 登录劫持
    const storedState = sessionStorage.getItem(`oauth_state_${provider}`);
    if (storedState) {
      sessionStorage.removeItem(`oauth_state_${provider}`);
      if (storedState !== state) {
        setStatus('error');
        setErrorMsg('安全验证失败，请重新登录');
        return;
      }
    }

    if (error) {
      setStatus('error');
      setErrorMsg(params.get('error_description') || '授权被拒绝');
      return;
    }

    if (!code) {
      setStatus('error');
      setErrorMsg('未收到授权码');
      return;
    }

    const handleOAuth = async () => {
      try {
        // 判断是"绑定账号"还是"登录"
        // 如果 sessionStorage 中有 oauth_mode_bind 标记，说明是绑定流程
        const isBindMode = sessionStorage.getItem('oauth_mode_bind') === '1';
        if (isBindMode) {
          sessionStorage.removeItem('oauth_mode_bind');
        }

        if (provider === 'github') {
          // GitHub 不支持绑定模式，始终走登录
          const result = await GitHubAuthService.loginWithGitHub(code);
          if (result.error) {
            setStatus('error');
            setErrorMsg(result.error);
          } else {
            setStatus('success');
            oauthLogin(result.user);
            setTimeout(() => navigate('/', { replace: true }), 1000);
          }
          return;
        }

        // Bangumi：区分登录和绑定
        const oauthResult = await BangumiAuthService.handleOAuthCallback(code);
        if (oauthResult.error) {
          setStatus('error');
          setErrorMsg(oauthResult.error);
          return;
        }

        if (isBindMode) {
          // 绑定流程：将 Bangumi token 存入数据库
          const bindResult = await BangumiAuthService.bindToCurrentUser(oauthResult);
          if (bindResult.error) {
            setStatus('error');
            setErrorMsg(bindResult.error);
          } else {
            // 绑定成功后自动导入收藏
            setStatus('importing');
            const jwt = sessionStorage.getItem('acg_jwt_token');
            const bangumiToken = StorageService.get('acg_bangumi_token');
            const bangumiUser = StorageService.get('acg_bangumi_user');

            try {
              const res = await fetch(`${API_BASE}/api/bangumi-sync/import`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${jwt}`,
                },
                body: JSON.stringify({
                  bangumiToken,
                  bangumiUsername: bangumiUser?.username || bangumiUser?.nickname,
                }),
              });
              const importData = await res.json();
              setImportResult(importData);
            } catch (err) {
              console.warn('Bangumi 自动导入失败:', err);
              setImportResult({ error: err.message });
            }

            setStatus('success');
            setTimeout(() => navigate('/', { replace: true }), 2000);
          }
        } else {
          // 登录流程：复用已获取的 oauthResult，避免重复使用 code
          const result = await BangumiAuthService.loginWithBangumi(code, oauthResult);
          if (result.error) {
            setStatus('error');
            setErrorMsg(result.error);
          } else {
            // 登录成功后自动导入收藏
            setStatus('importing');
            const jwt = sessionStorage.getItem('acg_jwt_token');
            const bangumiToken = StorageService.get('acg_bangumi_token');
            const bangumiUser = StorageService.get('acg_bangumi_user');

            try {
              const res = await fetch(`${API_BASE}/api/bangumi-sync/import`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${jwt}`,
                },
                body: JSON.stringify({
                  bangumiToken,
                  bangumiUsername: bangumiUser?.username || bangumiUser?.nickname,
                }),
              });
              const importData = await res.json();
              setImportResult(importData);
            } catch (err) {
              console.warn('Bangumi 自动导入失败:', err);
              setImportResult({ error: err.message });
            }

            setStatus('success');
            oauthLogin(result.user);
            setTimeout(() => navigate('/', { replace: true }), 2000);
          }
        }
      } catch (err) {
        setStatus('error');
        setErrorMsg(err.message || '登录失败，请重试');
      }
    };

    handleOAuth().finally(() => {
      // 清除 URL 中的 code 参数，防止用户刷新页面时重复使用 code
      if (window.location.search.includes('code=')) {
        window.history.replaceState(null, null, window.location.pathname);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="oauth-callback-page">
      <div className="oauth-callback-card glass-modal">
        {status === 'loading' && (
          <>
            <Loader2 size={48} className="oauth-spinning" />
            <h2>正在登录...</h2>
            <p>请稍候，正在验证你的授权信息</p>
          </>
        )}
        {status === 'importing' && (
          <>
            <Download size={48} className="oauth-spinning" />
            <h2>正在导入收藏...</h2>
            <p>从 Bangumi 同步你的收藏数据</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle size={48} className="oauth-success-icon" />
            <h2>登录成功！</h2>
            {importResult && !importResult.error && (
              <p className="oauth-import-msg">
                已导入 {importResult.imported || 0} 条收藏，跳过 {importResult.skipped || 0} 条
              </p>
            )}
            <p>正在跳转到首页...</p>
          </>
        )}
        {status === 'error' && (
          <>
            <XCircle size={48} className="oauth-error-icon" />
            <h2>登录失败</h2>
            <p className="oauth-error-msg">{errorMsg}</p>
            <button className="oauth-retry-btn" onClick={() => navigate('/')}>返回首页</button>
          </>
        )}
      </div>
    </div>
  );
}
