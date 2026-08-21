import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Clock, User, MessageCircle, Loader2, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { SuperService } from '../../services/SuperService';
import { useApp } from '../../context/AppContext';
import PostItem from './PostItem';
import ReplyInput from './ReplyInput';
import './TopicDetail.css';

const PAGE_SIZE = 50;

/**
 * TopicDetail - 话题详情页组件
 * 展示话题详情和帖子列表，支持回复和分页
 */
export default function TopicDetail() {
  const { topicId } = useParams();
  const { currentUser, isAuthenticated, openAuth } = useApp();

  // State
  const [topic, setTopic] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Reply state
  const [relatedPostId, setRelatedPostId] = useState(null);
  const [relatedAuthor, setRelatedAuthor] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Fetch topic detail
  const fetchTopic = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await SuperService.getTopicDetail(topicId);
      setTopic(data);
    } catch (err) {
      setError(err.message || '加载话题详情失败');
    } finally {
      setLoading(false);
    }
  }, [topicId]);

  // Fetch posts
  const fetchPosts = useCallback(async () => {
    try {
      const res = await SuperService.getTopicPosts(topicId, page, PAGE_SIZE);
      setPosts(res.data || []);
      setTotal(res.total || 0);
      setTotalPages(Math.max(1, Math.ceil((res.total || 0) / PAGE_SIZE)));
    } catch (err) {
      // Posts fetch error is non-critical, just log
      console.error('Failed to fetch posts:', err);
      setPosts([]);
    }
  }, [topicId, page]);

  useEffect(() => {
    fetchTopic();
    fetchPosts();
  }, [fetchTopic, fetchPosts]);

  // Handle reply
  const handleReply = useCallback(async (content, related, turnstileToken) => {
    if (!isAuthenticated) {
      openAuth();
      return;
    }

    setSubmitting(true);
    try {
      await SuperService.createPost(topicId, content, related, turnstileToken);
      // Refresh posts
      await fetchPosts();
      // Clear related state
      setRelatedPostId(null);
      setRelatedAuthor('');
    } catch (err) {
      alert(err.message || '回复失败，请重试');
    } finally {
      setSubmitting(false);
    }
  }, [topicId, isAuthenticated, openAuth, fetchPosts]);

  // Handle reply to specific post
  const handleReplyTo = useCallback((postId, authorName) => {
    if (!isAuthenticated) {
      openAuth();
      return;
    }
    setRelatedPostId(postId);
    setRelatedAuthor(authorName);
  }, [isAuthenticated, openAuth]);

  // Clear related
  const handleClearRelated = useCallback(() => {
    setRelatedPostId(null);
    setRelatedAuthor('');
  }, []);

  // Pagination
  const handlePrevPage = useCallback(() => {
    setPage(p => Math.max(1, p - 1));
  }, []);

  const handleNextPage = useCallback(() => {
    setPage(p => Math.min(totalPages, p + 1));
  }, [totalPages]);

  // Format time
  const formatTime = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);

    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
    if (diff < 2592000) return `${Math.floor(diff / 86400)}天前`;

    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${year}-${month}-${day}`;
  };

  // Loading state
  if (loading && !topic) {
    return (
      <div className="td-page">
        <div className="td-loading">
          <Loader2 size={32} className="td-spinning" />
          <p>加载中...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !topic) {
    return (
      <div className="td-page">
        <div className="td-error">
          <AlertCircle size={32} />
          <p>{error}</p>
          <Link to="/super" className="td-back-link">
            <ArrowLeft size={16} />
            返回超展开
          </Link>
        </div>
      </div>
    );
  }

  const topicTitle = topic?.title || '话题详情';
  const topicAuthor = topic?.author || '匿名用户';
  const topicAvatar = topic?.author_avatar || '';
  const topicCreatedAt = topic?.created_at || '';

  return (
    <div className="td-page">
      {/* Back link */}
      <div className="td-back">
        <Link to="/super" className="td-back-link">
          <ArrowLeft size={16} />
          <span>返回超展开</span>
        </Link>
      </div>

      {/* Topic header */}
      <div className="td-header">
        <h1 className="td-title">{topicTitle}</h1>
        <div className="td-meta">
          <div className="td-author-info">
            {topicAvatar ? (
              <img src={topicAvatar} alt={topicAuthor} className="td-author-avatar" />
            ) : (
              <div className="td-author-avatar-placeholder">
                <User size={16} />
              </div>
            )}
            <span className="td-author-name">{topicAuthor}</span>
          </div>
          <span className="td-time">
            <Clock size={14} />
            <span>{formatTime(topicCreatedAt)}</span>
          </span>
          <span className="td-stats">
            <MessageCircle size={14} />
            <span>{total} 帖子</span>
          </span>
        </div>
      </div>

      {/* Reply input */}
      <div className="td-reply-section">
        <h2 className="td-reply-title">发表回复</h2>
        <ReplyInput
          onSubmit={handleReply}
          related={relatedPostId}
          relatedAuthor={relatedAuthor}
          disabled={!isAuthenticated}
          loading={submitting}
          onClearRelated={handleClearRelated}
        />
      </div>

      {/* Posts list */}
      <div className="td-posts-section">
        <div className="td-posts-header">
          <h2 className="td-posts-title">帖子列表</h2>
          <span className="td-posts-count">共 {total} 条</span>
        </div>

        {posts.length === 0 && !loading ? (
          <div className="td-empty-posts">
            <MessageCircle size={48} />
            <p>暂无帖子，快来发表第一条吧！</p>
          </div>
        ) : (
          <div className="td-posts-list">
            {posts.map((post, index) => (
              <PostItem
                key={post.id}
                post={post}
                floor={(page - 1) * PAGE_SIZE + index + 1}
                onReply={handleReplyTo}
              />
            ))}
          </div>
        )}

        {/* Loading overlay */}
        {loading && posts.length > 0 && (
          <div className="td-loading-overlay">
            <Loader2 size={24} className="td-spinning" />
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="td-pagination">
            <button
              className="td-page-btn"
              disabled={page <= 1 || loading}
              onClick={handlePrevPage}
            >
              <ChevronLeft size={16} />
              上一页
            </button>
            <span className="td-page-info">
              {page} / {totalPages}
            </span>
            <button
              className="td-page-btn"
              disabled={page >= totalPages || loading}
              onClick={handleNextPage}
            >
              下一页
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

    </div>
  );
}