import { useState, useCallback, useEffect } from 'react';
import { MessageCircle, Clock, Loader2, AlertCircle, ChevronLeft, ChevronRight, Users, FileText } from 'lucide-react';
import { SuperService } from '../../services/SuperService';
import { useApp } from '../../context/AppContext';
import { BangumiAuthService, StorageService } from '../../services/api';
import GroupCard from './GroupCard';
import BangumiBindPrompt from './BangumiBindPrompt';
import TopicCard from './TopicCard';
import './SuperHome.css';

const PAGE_SIZE = 20;

/**
 * SuperHome - 超展开首页组件
 * 默认按时间显示所有小组最近的帖子，可切换到小组列表
 */
export default function SuperHome() {
  const { currentUser, bangumiBound, setBangumiBound } = useApp();

  // View mode: 'topics' (default) | 'groups'
  const [viewMode, setViewMode] = useState('topics');

  // Topics state
  const [topics, setTopics] = useState([]);
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [topicsError, setTopicsError] = useState(null);
  const [topicsPage, setTopicsPage] = useState(1);
  const [topicsTotalPages, setTopicsTotalPages] = useState(1);
  const [topicsTotal, setTopicsTotal] = useState(0);

  // Groups state
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsError, setGroupsError] = useState(null);
  const [groupsPage, setGroupsPage] = useState(1);
  const [groupsTotalPages, setGroupsTotalPages] = useState(1);
  const [groupsTotal, setGroupsTotal] = useState(0);
  const [sortBy, setSortBy] = useState('members');

  const [syncing, setSyncing] = useState(false);

  // 自动同步 localStorage 中的 Bangumi token 到 D1 数据库
  useEffect(() => {
    if (!currentUser || bangumiBound) return;
    const localToken = StorageService.get('acg_bangumi_token');
    if (!localToken) return;
    setSyncing(true);
    const refreshToken = StorageService.get('acg_bangumi_refresh');
    const bangumiUser = StorageService.get('acg_bangumi_user');
    const expiresAt = StorageService.get('acg_bangumi_token_expires');
    BangumiAuthService.bindToCurrentUser({
      access_token: localToken,
      refresh_token: refreshToken,
      expires_in: expiresAt ? Math.floor((expiresAt - Date.now()) / 1000) : null,
      user_id: bangumiUser?.id,
      user: bangumiUser,
    }).then(result => {
      if (result.ok || result.success) {
        setBangumiBound(true);
      }
    }).catch(err => {
      console.warn('自动同步 Bangumi token 失败:', err);
    }).finally(() => {
      setSyncing(false);
    });
  }, [currentUser, bangumiBound, setBangumiBound]);

  // Fetch latest topics
  const fetchTopics = useCallback(async () => {
    if (!currentUser || !bangumiBound) {
      setTopicsLoading(false);
      return;
    }
    setTopicsLoading(true);
    setTopicsError(null);
    try {
      const res = await SuperService.getLatestTopics(topicsPage, PAGE_SIZE, 'all');
      setTopics(res.data || []);
      setTopicsTotal(res.total || 0);
      setTopicsTotalPages(Math.max(1, Math.ceil((res.total || 0) / PAGE_SIZE)));
    } catch (err) {
      setTopicsError(err.message || '加载话题列表失败');
      setTopics([]);
    } finally {
      setTopicsLoading(false);
    }
  }, [topicsPage, currentUser, bangumiBound]);

  // Fetch groups (only when switching to groups view)
  const fetchGroups = useCallback(async () => {
    if (!currentUser || !bangumiBound) {
      setGroupsLoading(false);
      return;
    }
    setGroupsLoading(true);
    setGroupsError(null);
    try {
      const res = await SuperService.getGroups(groupsPage, PAGE_SIZE, sortBy);
      setGroups(res.data || []);
      setGroupsTotal(res.total || 0);
      setGroupsTotalPages(Math.max(1, Math.ceil((res.total || 0) / PAGE_SIZE)));
    } catch (err) {
      setGroupsError(err.message || '加载小组列表失败');
      setGroups([]);
    } finally {
      setGroupsLoading(false);
    }
  }, [groupsPage, sortBy, currentUser, bangumiBound]);

  useEffect(() => {
    fetchTopics();
  }, [fetchTopics]);

  useEffect(() => {
    if (viewMode === 'groups') fetchGroups();
  }, [viewMode, fetchGroups]);

  // Reset page when sort changes
  useEffect(() => {
    setGroupsPage(1);
  }, [sortBy]);

  // Syncing state
  if (syncing) {
    return (
      <div className="sh-page">
        <div className="sh-header">
          <h1 className="sh-title">超展开</h1>
          <p className="sh-subtitle">Bangumi 小组讨论区</p>
        </div>
        <div className="sh-loading">
          <Loader2 size={32} className="sh-spinning" />
          <p>正在同步 Bangumi 账号信息...</p>
        </div>
      </div>
    );
  }

  // Not bound state
  if (!currentUser || !bangumiBound) {
    return (
      <div className="sh-page">
        <div className="sh-header">
          <h1 className="sh-title">超展开</h1>
          <p className="sh-subtitle">Bangumi 小组讨论区</p>
        </div>
        <BangumiBindPrompt />
      </div>
    );
  }

  // Topics loading state (first load)
  if (topicsLoading && topics.length === 0 && viewMode === 'topics') {
    return (
      <div className="sh-page">
        <div className="sh-header">
          <h1 className="sh-title">超展开</h1>
          <p className="sh-subtitle">Bangumi 小组讨论区</p>
        </div>
        <div className="sh-loading">
          <Loader2 size={32} className="sh-spinning" />
          <p>加载中...</p>
        </div>
      </div>
    );
  }

  // Topics error state
  if (topicsError && topics.length === 0 && viewMode === 'topics') {
    return (
      <div className="sh-page">
        <div className="sh-header">
          <h1 className="sh-title">超展开</h1>
          <p className="sh-subtitle">Bangumi 小组讨论区</p>
        </div>
        <div className="sh-error">
          <AlertCircle size={32} />
          <p>{topicsError}</p>
          <button className="sh-retry-btn" onClick={fetchTopics}>重试</button>
        </div>
      </div>
    );
  }

  return (
    <div className="sh-page">
      {/* Header */}
      <div className="sh-header">
        <h1 className="sh-title">超展开</h1>
        <p className="sh-subtitle">Bangumi 小组讨论区</p>
      </div>

      {/* View mode tabs */}
      <div className="sh-view-tabs">
        <button
          className={`sh-view-tab ${viewMode === 'topics' ? 'active' : ''}`}
          onClick={() => setViewMode('topics')}
        >
          <Clock size={14} />
          <span>最新话题</span>
        </button>
        <button
          className={`sh-view-tab ${viewMode === 'groups' ? 'active' : ''}`}
          onClick={() => setViewMode('groups')}
        >
          <Users size={14} />
          <span>小组列表</span>
        </button>
      </div>

      {/* Topics view */}
      {viewMode === 'topics' && (
        <>
          <div className="sh-stats">
            <span className="sh-stat-item">
              共 <strong>{topicsTotal}</strong> 个话题
            </span>
          </div>

          <div className="sh-topics-list">
            {topics.length === 0 && !topicsLoading ? (
              <div className="sh-empty">
                <FileText size={48} />
                <p>暂无话题数据</p>
              </div>
            ) : (
              topics.map(topic => (
                <TopicCard key={topic.id} topic={topic} />
              ))
            )}
          </div>

          {topicsLoading && topics.length > 0 && (
            <div className="sh-loading-overlay">
              <Loader2 size={24} className="sh-spinning" />
            </div>
          )}

          {topicsTotalPages > 1 && (
            <div className="sh-pagination">
              <button
                className="sh-page-btn"
                disabled={topicsPage <= 1 || topicsLoading}
                onClick={() => setTopicsPage(p => Math.max(1, p - 1))}
              >
                <ChevronLeft size={16} />
                上一页
              </button>
              <span className="sh-page-info">
                {topicsPage} / {topicsTotalPages}
              </span>
              <button
                className="sh-page-btn"
                disabled={topicsPage >= topicsTotalPages || topicsLoading}
                onClick={() => setTopicsPage(p => Math.min(topicsTotalPages, p + 1))}
              >
                下一页
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </>
      )}

      {/* Groups view */}
      {viewMode === 'groups' && (
        <>
          <div className="sh-sort-group">
            {[
              { key: 'members', label: '成员数', icon: Users },
              { key: 'posts', label: '帖子数', icon: MessageCircle },
              { key: 'topics', label: '话题数', icon: FileText },
              { key: 'createdAt', label: '创建时间', icon: Clock },
            ].map(opt => (
              <button
                key={opt.key}
                className={`sh-sort-btn ${sortBy === opt.key ? 'active' : ''}`}
                onClick={() => setSortBy(opt.key)}
              >
                <opt.icon size={14} />
                <span>{opt.label}</span>
              </button>
            ))}
          </div>

          <div className="sh-stats">
            <span className="sh-stat-item">
              共 <strong>{groupsTotal}</strong> 个小组
            </span>
          </div>

          <div className="sh-grid">
            {groupsLoading && groups.length === 0 ? (
              <div className="sh-loading">
                <Loader2 size={32} className="sh-spinning" />
                <p>加载中...</p>
              </div>
            ) : groupsError ? (
              <div className="sh-error">
                <AlertCircle size={32} />
                <p>{groupsError}</p>
                <button className="sh-retry-btn" onClick={fetchGroups}>重试</button>
              </div>
            ) : groups.length === 0 ? (
              <div className="sh-empty">
                <Users size={48} />
                <p>暂无小组数据</p>
              </div>
            ) : (
              groups.map(group => (
                <GroupCard key={group.id} group={group} />
              ))
            )}
          </div>

          {groupsLoading && groups.length > 0 && (
            <div className="sh-loading-overlay">
              <Loader2 size={24} className="sh-spinning" />
            </div>
          )}

          {groupsTotalPages > 1 && (
            <div className="sh-pagination">
              <button
                className="sh-page-btn"
                disabled={groupsPage <= 1 || groupsLoading}
                onClick={() => setGroupsPage(p => Math.max(1, p - 1))}
              >
                <ChevronLeft size={16} />
                上一页
              </button>
              <span className="sh-page-info">
                {groupsPage} / {groupsTotalPages}
              </span>
              <button
                className="sh-page-btn"
                disabled={groupsPage >= groupsTotalPages || groupsLoading}
                onClick={() => setGroupsPage(p => Math.min(groupsTotalPages, p + 1))}
              >
                下一页
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
