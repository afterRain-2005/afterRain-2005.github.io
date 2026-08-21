import { useState, useEffect, useRef } from 'react';
import { Send, X, Loader2 } from 'lucide-react';

// Bangumi 的 Turnstile sitekey（从环境变量获取）
const BANGUMI_TURNSTILE_SITEKEY =
  typeof import.meta !== 'undefined' && import.meta.env?.VITE_BANGUMI_TURNSTILE_SITEKEY;

/**
 * ReplyInput - 回复输入组件
 * 用于 TopicDetail 页面中发表回复
 * @param {Function} onSubmit - 提交回调 (content, related, turnstileToken)
 * @param {number|null} related - 关联楼层 ID
 * @param {string} relatedAuthor - 关联楼层作者名
 * @param {boolean} disabled - 是否禁用
 * @param {boolean} loading - 是否正在提交
 * @param {Function} onClearRelated - 清除关联回调
 */
export default function ReplyInput({
  onSubmit,
  related = null,
  relatedAuthor = '',
  disabled = false,
  loading = false,
  onClearRelated,
}) {
  const [content, setContent] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileRef = useRef(null);
  const containerId = useRef('cf-turnstile-reply-' + Math.random().toString(36).slice(2, 9));

  // 加载 Turnstile 脚本并渲染 widget
  useEffect(() => {
    if (!BANGUMI_TURNSTILE_SITEKEY || disabled) return;

    const renderWidget = () => {
      if (window.turnstile) {
        turnstileRef.current = window.turnstile.render('#' + containerId.current, {
          sitekey: BANGUMI_TURNSTILE_SITEKEY,
          callback: (token) => setTurnstileToken(token),
          'expired-callback': () => setTurnstileToken(''),
        });
      }
    };

    const existing = document.querySelector('script[src*="turnstile"]');
    if (existing) {
      renderWidget();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    script.onload = renderWidget;
    document.head.appendChild(script);

    return () => {
      if (window.turnstile && turnstileRef.current !== null) {
        try { window.turnstile.remove(turnstileRef.current); } catch {}
      }
    };
  }, [disabled]);

  const handleSubmit = () => {
    if (!content.trim() || disabled || loading) return;
    if (BANGUMI_TURNSTILE_SITEKEY && !turnstileToken) return;
    onSubmit && onSubmit(content.trim(), related, turnstileToken);
    setContent('');
    // 重置 Turnstile 以获取新 token
    if (window.turnstile && turnstileRef.current !== null) {
      try { window.turnstile.reset(turnstileRef.current); } catch {}
    }
    setTurnstileToken('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSubmit();
    }
  };

  const canSubmit = content.trim() && !disabled && !loading &&
    (!BANGUMI_TURNSTILE_SITEKEY || turnstileToken);

  return (
    <div className="ri-container">
      {/* 回复关联提示 */}
      {related && (
        <div className="ri-related-bar">
          <span className="ri-related-text">
            回复 <strong>{relatedAuthor}</strong> (#{related} 楼)
          </span>
          <button className="ri-clear-btn" onClick={onClearRelated}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* 输入区 */}
      <div className="ri-input-area">
        <textarea
          className="ri-textarea"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? '请先登录后再回复' : '写下你的回复... (Ctrl+Enter 发送)'}
          disabled={disabled || loading}
          rows={4}
        />

        {/* 发送按钮 */}
        <button
          className="ri-send-btn"
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {loading ? (
            <Loader2 size={18} className="ri-spinning" />
          ) : (
            <Send size={18} />
          )}
          <span>{loading ? '发送中...' : '发送'}</span>
        </button>
      </div>

      {/* Turnstile 人机验证 */}
      {BANGUMI_TURNSTILE_SITEKEY && !disabled && (
        <div id={containerId.current} className="ri-turnstile" />
      )}

      {/* 提示 */}
      <div className="ri-hint">
        <span>支持 Markdown 格式，Ctrl+Enter 快捷发送</span>
      </div>
    </div>
  );
}
