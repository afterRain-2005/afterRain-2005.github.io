import { Link } from 'react-router-dom';
import { MessageCircle, Clock } from 'lucide-react';
import './TopicCard.css';

/**
 * TopicCard - 话题卡片组件
 * 用于超展开功能中展示话题信息
 * @param {Object} topic - 话题数据
 * @param {string} topic.id - 话题ID
 * @param {string} topic.title - 话题标题
 * @param {string} topic.author - 作者用户名
 * @param {string} [topic.author_avatar] - 作者头像URL
 * @param {number} [topic.replies] - 回复数
 * @param {string} [topic.created_at] - 创建时间
 * @param {string} [topic.updated_at] - 更新时间
 */
export default function TopicCard({ topic }) {
  const {
    id,
    title,
    author,
    author_avatar,
    replies = 0,
    created_at,
    updated_at,
    group,
  } = topic;

  // 格式化时间显示
  const formatTime = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);

    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
    if (diff < 2592000) return `${Math.floor(diff / 86400)}天前`;

    // 超过30天显示具体日期
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}-${day}`;
  };

  // 截断标题到80字符
  const truncatedTitle = title && title.length > 80 ? title.slice(0, 80) + '...' : title;

  // 显示时间：优先使用更新时间，否则使用创建时间
  const displayTime = updated_at || created_at;

  return (
    <Link to={`/super/topic/${id}`} className="tc-card">
      <div className="tc-avatar">
        {author_avatar ? (
          <img src={author_avatar} alt={author || ''} loading="lazy" />
        ) : (
          <div className="tc-avatar-placeholder">
            <span>{(author || '?')[0]}</span>
          </div>
        )}
      </div>

      <div className="tc-content">
        <h3 className="tc-title">{truncatedTitle}</h3>

        <div className="tc-meta">
          <span className="tc-author">{author || '匿名用户'}</span>
          {group && (
            <span className="tc-group">
              {group.icon && <img src={group.icon} alt="" className="tc-group-icon" />}
              <span>{group.title}</span>
            </span>
          )}
          <span className="tc-stat">
            <MessageCircle size={14} />
            <span>{replies.toLocaleString()}</span>
          </span>
          <span className="tc-time">
            <Clock size={14} />
            <span>{formatTime(displayTime)}</span>
          </span>
        </div>
      </div>
    </Link>
  );
}