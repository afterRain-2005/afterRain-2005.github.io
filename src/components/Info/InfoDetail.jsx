import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { BangumiService, RatingService, FavoriteService, CollectionMarkService, BangumiCommentService, ApiError, isOnline, StorageService, Wenku8Service } from '../../services/api';
import { behaviorCollector } from '../../lib/BehaviorCollector';
import { sessionProfile } from '../../lib/SessionProfile';
import { BangumiDataService } from '../../services/BangumiDataService';
import HikarinagiService from '../../services/HikarinagiService';
import { SourceMerger } from '../../services/SourceMerger';
import { Star, ExternalLink, Heart, Share2, Bookmark, MessageCircle, Send, ArrowLeft, RefreshCw, Users, Calendar, Tv, BookOpen, Gamepad2, ChevronRight, Play, Loader2, Filter, ChevronDown, AlertCircle, ChevronUp, ShieldOff, Search, Download, BookText, Sparkles, Check, X, MessageSquare, Lock, Eye, MoreVertical, Lightbulb } from 'lucide-react';
import { MarkdownRenderer } from '../Common/MarkdownEditor/MarkdownEditor';
import { useState, useEffect, useCallback, useRef } from 'react';
import { mediaSourceManager } from '../../services/media/MediaSourceManager';
import { MatchKind, MediaSourceKind } from '../../services/media/types';
import FansubGroupsPanel from './FansubGroups';
import { extractPreview, typeToKey } from '../../utils/subjectType';
import './InfoDetail.css';

const API_BASE = import.meta.env.VITE_OAUTH_PROXY_URL || 'https://anispace-oauth-proxy.lyw2373314970.workers.dev';

const TYPE_ICONS = { 1: BookOpen, 2: Tv, 4: Gamepad2 };
const TYPE_LABELS = { 1: '小说', 2: '动画', 3: '音乐', 4: '游戏', 6: '三次元' };
const WEEKDAYS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const FALLBACK_AVATAR = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="80" fill="%23f9f3f5"%3E%3Crect width="80" height="80" rx="40"/%3E%3Ctext x="40" y="44" text-anchor="middle" fill="%23c8bfcc" font-size="12"%3E%3F%3C/text%3E%3C/svg%3E';
const FALLBACK_COVER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="280" fill="%23f9f3f5"%3E%3Crect width="200" height="280" rx="10"/%3E%3Ctext x="100" y="140" text-anchor="middle" fill="%23d4b8c0" font-size="14"%3ENo Image%3C/text%3E%3C/svg%3E';

function AvatarImg({ src, alt, size = 40 }) {
  const [failed, setFailed] = useState(false);
  return <img src={failed ? FALLBACK_AVATAR : src} alt={alt} className="detail-avatar-img" style={{ width: size, height: size }} onError={() => setFailed(true)} loading="lazy" />;
}

function CoverImg({ src, alt }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="detail-cover-wrap">
      {!loaded && !failed && <div className="detail-cover-skeleton shimmer" />}
      <img src={failed ? FALLBACK_COVER : src} alt={alt} className={`detail-cover ${loaded ? 'loaded' : ''}`} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} loading="lazy" />
    </div>
  );
}

function VerticalRatingDistribution({ rating, onFilterChange, activeFilter }) {
  if (!rating || !rating.count) return null;
  const counts = rating.count;
  const total = rating.total || 0;
  if (total === 0) return null;
  const maxCount = Math.max(...Object.values(counts), 1);

  const scoreColors = {
    10: '#e84393', 9: '#fd79a8', 8: '#e886a2', 7: '#fab1a0',
    6: '#ffeaa7', 5: '#dfe6e9', 4: '#b2bec3', 3: '#636e72',
    2: '#2d3436', 1: '#6c5ce7',
  };

  return (
    <div className="vertical-rating-dist terminal-rating">
      <div className="terminal-rating-bars">
        {[10,9,8,7,6,5,4,3,2,1].map(s => {
          const count = counts[s] || 0;
          const totalPct = total > 0 ? ((count / total) * 100).toFixed(1) : 0;
          const filled = Math.round((count / maxCount) * 40);
          const bar = '█'.repeat(filled) + '░'.repeat(40 - filled);
          const isActive = activeFilter === s;
          const isAnyFilter = activeFilter !== null;
          return (
            <button key={s} className={`terminal-rating-row ${isActive ? 'active' : ''} ${isAnyFilter && !isActive ? 'dimmed' : ''}`}
              onClick={() => onFilterChange(activeFilter === s ? null : s)} title={`${s}分: ${count}人 (${totalPct}%)`}>
              <span className="terminal-rating-score">{s}</span>
              <span className="terminal-rating-bar">{bar}</span>
              <span className="terminal-rating-pct">{totalPct}%</span>
            </button>
          );
        })}
      </div>
      {activeFilter && (
        <div className="vrd-filter-hint">
          <Filter size={12} /> 筛选: {activeFilter}分 ({counts[activeFilter] || 0}人)
          <button className="vrd-filter-clear" onClick={() => onFilterChange(null)}>清除</button>
        </div>
      )}
    </div>
  );
}

function InfoBoxItem({ item }) {
  if (!item || !item.key) return null;
  const values = Array.isArray(item.value) ? item.value : [item.value];
  return (
    <div className="infobox-row">
      <span className="infobox-key">{item.key}</span>
      <span className="infobox-value">
        {values.map((v, i) => {
          if (typeof v === 'object' && v.v) return <span key={i}>{v.v}{i < values.length - 1 ? ' / ' : ''}</span>;
          return <span key={i}>{String(v)}{i < values.length - 1 ? ' / ' : ''}</span>;
        })}
      </span>
    </div>
  );
}

// 按角色分组制作人员
function groupPersonsByRole(persons) {
  const groups = {};
  persons.forEach(p => {
    const role = p.role || '其他';
    if (!groups[role]) groups[role] = [];
    groups[role].push(p);
  });
  return groups;
}

function StaffGroup({ role, members, defaultCollapsed = false }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  if (!members || members.length === 0) return null;
  return (
    <div className="staff-group">
      <button className="staff-group-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="staff-group-role">{role}</span>
        <span className="staff-group-count">{members.length}</span>
        {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>
      {!collapsed && (
        <div className="staff-group-members">
          {members.map((p, i) => {
            const personImg = p.images?.medium || p.images?.grid || '';
            return (
              <div key={p.id || i} className="detail-staff-card">
                {personImg ? <AvatarImg src={personImg} alt={p.name} size={36} /> : <div className="detail-staff-avatar-placeholder">{(p.name || '?')[0]}</div>}
                <span className="detail-staff-name">{p.name}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── 集数进度 Tab 组件 ───
function EpisodeProgressTab({ subjectId, subjectType, episodes, episodesLoading, fetchEpisodes, user, API_BASE, collectionMark, onAutoMark }) {
  const [progressMap, setProgressMap] = useState({}); // { episodeId: { status, comment, is_private, ... } }
  const [progressLoading, setProgressLoading] = useState(false);
  const [commentModal, setCommentModal] = useState(null); // { episode, ...currentProgress }
  const [commentText, setCommentText] = useState('');
  const [commentPrivate, setCommentPrivate] = useState(false);
  const [commentStatus, setCommentStatus] = useState('watched');
  const [epComments, setEpComments] = useState([]);
  const [epCommentsLoading, setEpCommentsLoading] = useState(false);
  const [batchMenuOpen, setBatchMenuOpen] = useState(false);
  const batchMenuRef = useRef(null);

  // 加载用户进度
  const loadProgress = useCallback(async () => {
    if (!user || !subjectId) return;
    setProgressLoading(true);
    try {
      const token = localStorage.getItem('acg_token');
      const res = await fetch(`${API_BASE}/api/subjects/${subjectId}/progress`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      const map = {};
      (data.progress || []).forEach(p => { map[p.episode_id] = p; });
      setProgressMap(map);
    } catch (err) {
      console.warn('[EpisodeProgress] load progress failed:', err);
    } finally {
      setProgressLoading(false);
    }
  }, [user, subjectId, API_BASE]);

  // 加载公开集评
  const loadEpComments = useCallback(async () => {
    if (!subjectId) return;
    setEpCommentsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/subjects/${subjectId}/ep-comments?limit=50`);
      const data = await res.json();
      setEpComments(data.comments || []);
    } catch (err) {
      console.warn('[EpisodeProgress] load ep-comments failed:', err);
    } finally {
      setEpCommentsLoading(false);
    }
  }, [subjectId, API_BASE]);

  useEffect(() => { loadProgress(); }, [loadProgress]);
  useEffect(() => { loadEpComments(); }, [loadEpComments]);

  // 点击格子切换已看/未看
  const toggleEpisode = async (ep) => {
    if (!user) return;
    const current = progressMap[ep.id];
    const token = localStorage.getItem('acg_token');

    if (current) {
      // 取消标记
      try {
        await fetch(`${API_BASE}/api/subjects/${subjectId}/progress`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ episode_id: ep.id, episode_sort: ep.sort || ep.ep, status: null }),
        });
        setProgressMap(prev => {
          const next = { ...prev };
          delete next[ep.id];
          return next;
        });
      } catch (err) {
        console.warn('[EpisodeProgress] toggle failed:', err);
      }
    } else {
      // 标记已看
      try {
        await fetch(`${API_BASE}/api/subjects/${subjectId}/progress`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ episode_id: ep.id, episode_sort: ep.sort || ep.ep, status: 'watched' }),
        });
        setProgressMap(prev => ({
          ...prev,
          [ep.id]: { episode_id: ep.id, episode_sort: ep.sort || ep.ep, status: 'watched', is_private: 0, comment: '' },
        }));
        // 自动标记为「在看」
        if (!collectionMark && onAutoMark) {
          onAutoMark('doing');
        }
      } catch (err) {
        console.warn('[EpisodeProgress] toggle failed:', err);
      }
    }
  };

  // 打开评论弹窗
  const openCommentModal = (ep) => {
    const current = progressMap[ep.id];
    setCommentModal(ep);
    setCommentText(current?.comment || '');
    setCommentPrivate(current?.is_private === 1);
    setCommentStatus(current?.status || 'watched');
  };

  // 保存评论
  const saveComment = async () => {
    if (!user || !commentModal) return;
    const token = localStorage.getItem('acg_token');
    try {
      await fetch(`${API_BASE}/api/subjects/${subjectId}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          episode_id: commentModal.id,
          episode_sort: commentModal.sort || commentModal.ep,
          status: commentStatus,
          comment: commentText,
          is_private: commentPrivate,
        }),
      });
      setProgressMap(prev => ({
        ...prev,
        [commentModal.id]: {
          episode_id: commentModal.id,
          episode_sort: commentModal.sort || commentModal.ep,
          status: commentStatus,
          is_private: commentPrivate ? 1 : 0,
          comment: commentText,
        },
      }));
      setCommentModal(null);
      // 刷新公开集评
      loadEpComments();
    } catch (err) {
      console.warn('[EpisodeProgress] save comment failed:', err);
    }
  };

  // 批量操作
  const handleBatch = async (action) => {
    if (!user) return;
    const token = localStorage.getItem('acg_token');
    setBatchMenuOpen(false);
    try {
      if (action === 'mark_all_watched') {
        const unwatchedEps = episodes.filter(ep => !progressMap[ep.id]);
        if (unwatchedEps.length === 0) return;
        await fetch(`${API_BASE}/api/subjects/${subjectId}/progress/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            action: 'mark_all_watched',
            episodes: unwatchedEps.map(ep => ({ episode_id: ep.id, episode_sort: ep.sort || ep.ep })),
          }),
        });
        loadProgress();
      } else if (action === 'clear_all') {
        await fetch(`${API_BASE}/api/subjects/${subjectId}/progress/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: 'clear_all' }),
        });
        setProgressMap({});
      }
    } catch (err) {
      console.warn('[EpisodeProgress] batch failed:', err);
    }
  };

  // 点击外部关闭批量菜单
  useEffect(() => {
    if (!batchMenuOpen) return;
    const handler = (e) => {
      if (batchMenuRef.current && !batchMenuRef.current.contains(e.target)) setBatchMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [batchMenuOpen]);

  const watchedCount = Object.values(progressMap).filter(p => p.status === 'watched').length;
  const totalCount = episodes.length;

  return (
    <div className="episode-progress-tab">
      {/* 头部：标题 + 批量操作 */}
      <div className="ep-progress-header">
        <div className="ep-progress-stats">
          <span className="ep-progress-count">已看 {watchedCount}/{totalCount} 话</span>
          {totalCount > 0 && (
            <div className="ep-progress-bar">
              <div className="ep-progress-bar-fill" style={{ width: `${(watchedCount / totalCount) * 100}%` }} />
            </div>
          )}
        </div>
        {user && (
          <div className="ep-progress-batch" ref={batchMenuRef}>
            <button className="ep-batch-btn" onClick={() => setBatchMenuOpen(!batchMenuOpen)}>
              <MoreVertical size={14} /> 批量操作
            </button>
            {batchMenuOpen && (
              <div className="ep-batch-menu">
                <button onClick={() => handleBatch('mark_all_watched')}>
                  <Check size={14} /> 标记全部已看
                </button>
                <button onClick={() => handleBatch('clear_all')}>
                  <X size={14} /> 清除全部进度
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 格子区域 */}
      {episodesLoading || progressLoading ? (
        <div className="ep-progress-loading"><Loader2 size={20} className="spinning" /> 加载中...</div>
      ) : totalCount === 0 ? (
        <div className="ep-progress-empty">暂无剧集信息</div>
      ) : (
        <div className="ep-grid">
          {episodes.map((ep, i) => {
            const p = progressMap[ep.id];
            const isWatched = p?.status === 'watched';
            const isDropped = p?.status === 'dropped';
            const hasComment = p?.comment && p.comment.trim();
            return (
              <div
                key={ep.id || i}
                className={`ep-cell ${isWatched ? 'watched' : ''} ${isDropped ? 'dropped' : ''} ${hasComment ? 'has-comment' : ''}`}
                onClick={() => user && toggleEpisode(ep)}
                title={`${ep.name || `第${ep.sort || ep.ep || i + 1}话`}${hasComment ? ' (有评论)' : ''}`}
              >
                <span className="ep-cell-num">{ep.sort || ep.ep || i + 1}</span>
                {isWatched && <Check size={10} className="ep-cell-check" />}
                {isDropped && <X size={10} className="ep-cell-x" />}
                {hasComment && <MessageSquare size={8} className="ep-cell-comment-icon" />}
                <button
                  className="ep-cell-comment-btn"
                  onClick={(e) => { e.stopPropagation(); user && openCommentModal(ep); }}
                  title="评论"
                >
                  <MessageSquare size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* 公开集评列表 */}
      {epComments.length > 0 && (
        <div className="ep-public-comments">
          <h4 className="ep-public-comments-title">集评</h4>
          {epCommentsLoading ? (
            <div className="ep-progress-loading"><Loader2 size={16} className="spinning" /></div>
          ) : (
            <div className="ep-public-comments-list">
              {epComments.map(c => (
                <div key={c.id} className="ep-public-comment-item">
                  <img src={c.avatar || FALLBACK_AVATAR} alt="" className="ep-comment-avatar" />
                  <div className="ep-comment-body">
                    <span className="ep-comment-meta">
                      <strong>{c.username}</strong> · 第{c.episode_sort}话
                    </span>
                    <p className="ep-comment-text">{c.comment}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 评论弹窗 */}
      {commentModal && (
        <div className="ep-modal-overlay" onClick={() => setCommentModal(null)}>
          <div className="ep-modal" onClick={e => e.stopPropagation()}>
            <div className="ep-modal-header">
              <h3>第{commentModal.sort || commentModal.ep}话 {commentModal.name || ''}</h3>
              <button className="ep-modal-close" onClick={() => setCommentModal(null)}><X size={16} /></button>
            </div>
            <div className="ep-modal-body">
              {/* 状态切换 */}
              <div className="ep-modal-status">
                <button className={`ep-status-btn ${commentStatus === 'watched' ? 'active' : ''}`} onClick={() => setCommentStatus('watched')}>
                  <Eye size={14} /> 已看
                </button>
                <button className={`ep-status-btn ${commentStatus === 'dropped' ? 'active' : ''}`} onClick={() => setCommentStatus('dropped')}>
                  <X size={14} /> 弃看
                </button>
              </div>
              {/* 评论输入 */}
              <textarea
                className="ep-modal-textarea"
                placeholder="写点感想..."
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                maxLength={500}
                rows={3}
              />
              {/* 私密开关 */}
              <label className="ep-modal-private">
                <Lock size={12} />
                <span>仅自己可见</span>
                <input type="checkbox" checked={commentPrivate} onChange={e => setCommentPrivate(e.target.checked)} />
                <span className="ep-toggle-track">
                  <span className={`ep-toggle-thumb ${commentPrivate ? 'active' : ''}`} />
                </span>
              </label>
            </div>
            <div className="ep-modal-footer">
              <button className="ep-modal-cancel" onClick={() => setCommentModal(null)}>取消</button>
              <button className="ep-modal-save" onClick={saveComment}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function InfoDetail() {
  const { type: routeType, id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser, isAuthenticated, openAuth } = useApp();

  // 从搜索结果传递的预览信息（用于 NSFW 条目的部分显示）
  const preview = location.state?.preview || null;

  const [subject, setSubject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);

  const [characters, setCharacters] = useState([]);
  const [persons, setPersons] = useState([]);
  const [charsLoading, setCharsLoading] = useState(false);

  const [userScore, setUserScore] = useState(0);
  const [avgScore, setAvgScore] = useState(0);
  const [hoverScore, setHoverScore] = useState(0);
  const [isFav, setIsFav] = useState(false);
  const [collectionMark, setCollectionMark] = useState(null);
  const [newComment, setNewComment] = useState('');
  const [sortBy, setSortBy] = useState('latest');
  const [localComments, setLocalComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);

  const [bgmComments, setBgmComments] = useState([]);
  const [bgmCommentsLoading, setBgmCommentsLoading] = useState(false);
  const [bgmCommentsPage, setBgmCommentsPage] = useState(1);
  const [bgmCommentsHasMore, setBgmCommentsHasMore] = useState(true);
  const [activeRatingFilter, setActiveRatingFilter] = useState(null);

  const [bgmReviews, setBgmReviews] = useState([]);
  const [bgmReviewsLoading, setBgmReviewsLoading] = useState(false);
  const [bgmReviewsPage, setBgmReviewsPage] = useState(1);
  const [bgmReviewsHasMore, setBgmReviewsHasMore] = useState(true);

  const [commentSubTab, setCommentSubTab] = useState('local');

  // 相关推荐状态
  const [relatedSubjects, setRelatedSubjects] = useState([]);
  const [similarByTags, setSimilarByTags] = useState([]);
  const [recommendLoading, setRecommendLoading] = useState(false);

  // Tab 状态
  const [activeTab, setActiveTab] = useState('summary');
  const [displayedTitle, setDisplayedTitle] = useState('');
  const [showCursor, setShowCursor] = useState(true);
  const heroTitle = subject?.name_cn || subject?.name || '';

  // 打字机效果
  useEffect(() => {
    if (!heroTitle) return;
    setDisplayedTitle('');
    setShowCursor(true);
    let i = 0;
    const timer = setInterval(() => {
      if (i < heroTitle.length) {
        setDisplayedTitle(heroTitle.slice(0, i + 1));
        i++;
      } else {
        clearInterval(timer);
        setTimeout(() => setShowCursor(false), 1500);
      }
    }, 150);
    return () => clearInterval(timer);
  }, [heroTitle]);
  // 标签折叠状态
  const [tagsExpanded, setTagsExpanded] = useState(false);

  // 站内观看 Tab 状态
  const [watchEpisodes, setWatchEpisodes] = useState([]);
  const [watchEpisodesLoading, setWatchEpisodesLoading] = useState(false);
  const [selectedEp, setSelectedEp] = useState(null);
  const [mediaMatches, setMediaMatches] = useState([]);
  const [mediaSearching, setMediaSearching] = useState(false);
  const [mediaSearchError, setMediaSearchError] = useState(null);

  // 是否为 NSFW 条目（详情 API 返回 404 但有 preview 数据）
  const [isNsfw, setIsNsfw] = useState(false);

  // 播放平台链接
  const [platformLinks, setPlatformLinks] = useState(null);

  // 海外数据
  const [overseasData, setOverseasData] = useState(null);
  const [overseasLoading, setOverseasLoading] = useState(true);

  // Hikarinagi 关联数据（Bangumi ID 匹配）
  const [hikarinagiLinked, setHikarinagiLinked] = useState(null); // { type: 'galgame'|'lightnovel', data: {...}, downloadInfo: ... }
  const [hikarinagiLoading, setHikarinagiLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setOverseasLoading(true);
    SourceMerger.mergeAnimeData({ id, name: subject?.name, name_cn: subject?.name_cn }).then(result => {
      if (!cancelled) {
        setOverseasData(result);
        setOverseasLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setOverseasLoading(false);
    });
    return () => { cancelled = true; };
  }, [id, subject?.name, subject?.name_cn]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    BangumiDataService.getSitesByBgmId(id).then(item => {
      if (cancelled || !item?.sites) return;
      const links = [];
      const siteMeta = BangumiDataService.getSiteMeta();
      item.sites.forEach(site => {
        if (site.site === 'bangumi') return; // 跳过 Bangumi 自身
        const meta = siteMeta[site.site];
        if (!meta || meta.type !== 'onair') return; // 仅展示播放平台
        const url = BangumiDataService.generatePlatformUrl(site.site, site.id);
        if (url) {
          links.push({
            key: site.site,
            title: meta.title,
            url,
            regions: meta.regions || [],
          });
        }
      });
      if (!cancelled) setPlatformLinks(links);
    });
    return () => { cancelled = true; };
  }, [id]);

  // wenku8 轻小说相关状态
  const [wenku8Results, setWenku8Results] = useState([]);
  const [wenku8Loading, setWenku8Loading] = useState(false);
  const [wenku8Searched, setWenku8Searched] = useState(false);
  const [wenku8Chapters, setWenku8Chapters] = useState(null);
  const [wenku8ChaptersLoading, setWenku8ChaptersLoading] = useState(false);
  const [wenku8ActiveVolume, setWenku8ActiveVolume] = useState(0);
  const [novelReading, setNovelReading] = useState(false);
  const [novelChapterContent, setNovelChapterContent] = useState(null);
  const [novelChapterLoading, setNovelChapterLoading] = useState(false);
  const [novelCurrentChapter, setNovelCurrentChapter] = useState(null);

  const fetchDetail = useCallback(async () => {
    setLoading(true); setError(null); setProgress(10); setIsNsfw(false);
    try {
      setProgress(30);
      const data = await BangumiService.getSubjectDetail(id);
      setProgress(70);
      if (!data || !data.id) throw new ApiError('请求的内容不存在', 404, 'NOT_FOUND');
      setSubject(data); setProgress(90);

      // 异步查询 Hikarinagi 关联数据（仅游戏/小说类型，通过名字匹配）
      if (data.type === 4 || data.type === 1) {
        setHikarinagiLoading(true);
        const hkType = data.type === 4 ? 'galgame' : 'lightnovel';
        SourceMerger.mergeHikarinagiData({ id, name: data.name, name_cn: data.name_cn, type: data.type })
          .then(async (result) => {
            if (!result) {
              setHikarinagiLinked(null);
              return;
            }
            // 过滤相关推荐：仅保留能在 Bangumi 中搜到的条目
            let verifiedRelated = null;
            if (result.related) {
              verifiedRelated = await SourceMerger.filterRelatedByBangumi(result.related, data.type);
            }
            setHikarinagiLinked({
              type: hkType,
              data: result.detail || result.match,
              downloadInfo: result.downloadInfo,
              links: result.links,
              related: verifiedRelated,
            });
          })
          .catch(() => setHikarinagiLinked(null))
          .finally(() => setHikarinagiLoading(false));
      } else {
        setHikarinagiLinked(null);
        setHikarinagiLoading(false);
      }

      if (currentUser) {
        try {
          const ratingData = await RatingService.fetchUserRating(currentUser.id, parseInt(id));
          if (ratingData) setUserScore(ratingData.score);
        } catch {}
        try {
          const favResult = await FavoriteService.isFavoritedAsync(currentUser.id, 'info', parseInt(id));
          if (favResult) setIsFav(favResult.favorited);
        } catch {}
        try {
          const marks = await CollectionMarkService.getByUserId(currentUser.id);
          const myMark = (Array.isArray(marks) ? marks : []).find(m => String(m.subject_id) === String(id));
          if (myMark) setCollectionMark(myMark.status);
        } catch {}
      }
      setProgress(100);
      setCharsLoading(true);
      try {
        const [chars, pers] = await Promise.all([BangumiService.getSubjectCharacters(id), BangumiService.getSubjectPersons(id)]);
        setCharacters(chars); setPersons(pers);
      } catch { setCharacters([]); setPersons([]); }
      finally { setCharsLoading(false); }
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : new ApiError(err.message || '加载失败');
      // NSFW 条目：用 preview 数据构造最小 subject，走正常渲染流程
      if (apiErr.code === 'NOT_FOUND') {
        setIsNsfw(true);
        let nsfwPreview = preview;
        // 尝试通过搜索 API 获取高清封面和完整信息
        if (nsfwPreview && (nsfwPreview.name || nsfwPreview.name_cn)) {
          try {
            const searchName = nsfwPreview.name_cn || nsfwPreview.name;
            const searchResult = await BangumiService.searchSubjects(searchName, nsfwPreview.type || 0, 5, 0);
            const match = searchResult?.list?.find(r => String(r.id) === String(id));
            if (match && match.images?.large) {
              nsfwPreview = {
                ...nsfwPreview,
                name: match.name || nsfwPreview.name,
                name_cn: match.name_cn || nsfwPreview.name_cn,
                type: match.type || nsfwPreview.type,
                image: match.images.large,
                images: match.images,
                rating: match.rating,
                collection: match.collection,
                tags: match.tags,
                infobox: match.infobox,
                summary: match.summary,
              };
            }
          } catch {}
        }
        if (!nsfwPreview) {
          nsfwPreview = {
            id: parseInt(id),
            name: `条目 #${id}`,
            name_cn: '',
            type: 2,
            image: '',
            images: {},
          };
        }
        setSubject({
          id: parseInt(id),
          name: nsfwPreview.name || '',
          name_cn: nsfwPreview.name_cn || '',
          type: nsfwPreview.type || 2,
          images: nsfwPreview.images || { large: nsfwPreview.image || '', common: nsfwPreview.image || '' },
          rating: nsfwPreview.rating || { score: 0, total: 0, count: {} },
          collection: nsfwPreview.collection || { wish: 0, collect: 0, doing: 0, on_hold: 0, dropped: 0 },
          tags: nsfwPreview.tags || [],
          infobox: nsfwPreview.infobox || [],
          summary: nsfwPreview.summary || '',
        });
        setCharacters([]); setPersons([]);
        // 仍然获取用户评分/收藏/收录数据
        if (currentUser) {
          try {
            const ratingData = await RatingService.fetchUserRating(currentUser.id, parseInt(id));
            if (ratingData) setUserScore(ratingData.score);
          } catch {}
          try {
            const favResult = await FavoriteService.isFavoritedAsync(currentUser.id, 'info', parseInt(id));
            if (favResult) setIsFav(favResult.favorited);
          } catch {}
          try {
            const marks = await CollectionMarkService.getByUserId(currentUser.id);
            const myMark = (Array.isArray(marks) ? marks : []).find(m => String(m.subject_id) === String(id));
            if (myMark) setCollectionMark(myMark.status);
          } catch {}
        }
      } else {
        setError(apiErr);
      }
    } finally { setLoading(false); }
  }, [id, currentUser, preview]);

  const fetchBgmComments = useCallback(async (page = 1) => {
    if (!id) return;
    setBgmCommentsLoading(true);
    try {
      const result = await BangumiCommentService.getComments(parseInt(id), 20, (page - 1) * 20);
      if (result.error) throw new Error(result.error);
      const comments = (result.data || []).map(c => ({
        id: c.id,
        username: c.user?.nickname || c.user?.username || '匿名',
        avatar: c.user?.avatar?.medium || c.user?.avatar?.small || FALLBACK_AVATAR,
        content: c.comment || '',
        score: c.rate || 0,
        createdAt: c.updatedAt ? new Date(c.updatedAt * 1000).toLocaleDateString('zh-CN') : '',
      }));
      if (page === 1) setBgmComments(comments);
      else setBgmComments(prev => [...prev, ...comments]);
      setBgmCommentsHasMore(comments.length >= 20);
    } catch {
      if (page === 1) setBgmComments([]);
    } finally {
      setBgmCommentsLoading(false);
    }
  }, [id]);

  const fetchBgmReviews = useCallback(async (page = 1) => {
    if (!id) return;
    setBgmReviewsLoading(true);
    try {
      const result = await BangumiCommentService.getReviews(parseInt(id), 10, (page - 1) * 10);
      if (result.error) throw new Error(result.error);
      const reviews = (result.data || []).map(r => ({
        id: r.id,
        username: r.user?.nickname || r.user?.username || '匿名',
        avatar: r.user?.avatar?.medium || r.user?.avatar?.small || FALLBACK_AVATAR,
        title: r.entry?.title || '',
        summary: r.entry?.summary || '',
        replies: r.entry?.replies || 0,
        entryId: r.entry?.id || null,
        createdAt: r.entry?.updatedAt ? new Date(r.entry.updatedAt * 1000).toLocaleDateString('zh-CN') : '',
      }));
      if (page === 1) setBgmReviews(reviews);
      else setBgmReviews(prev => [...prev, ...reviews]);
      setBgmReviewsHasMore(reviews.length >= 10);
    } catch {
      if (page === 1) setBgmReviews([]);
    } finally {
      setBgmReviewsLoading(false);
    }
  }, [id]);

  const loadMoreReviews = () => {
    const nextPage = bgmReviewsPage + 1;
    setBgmReviewsPage(nextPage);
    fetchBgmReviews(nextPage);
  };

  useEffect(() => { fetchDetail(); }, [fetchDetail]);
  useEffect(() => { fetchBgmComments(1); }, [fetchBgmComments]);
  useEffect(() => { fetchBgmReviews(1); }, [fetchBgmReviews]);
  useEffect(() => {
    RatingService.getAverageScoreAsync(parseInt(id)).then(score => {
      setAvgScore(score);
    }).catch(() => {});
  }, [id]);

  // 从 Bangumi 拉取用户评分初始化 userScore
  useEffect(() => {
    if (!currentUser) return;
    BangumiCommentService.getUserCollection(parseInt(id))
      .then(result => {
        if (result && !result.error && result.rate > 0) {
          setUserScore(result.rate);
        }
      })
      .catch(() => {});
  }, [id, currentUser]);

  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); }, [id]);

  const handleRate = async (score) => {
    if (!isAuthenticated) { openAuth(); return; }
    try {
      // 1. 保存站内评分
      await RatingService.addRatingAsync(currentUser.id, parseInt(id), subject?.type || 2, score);
      setUserScore(score);
      behaviorCollector.trackRate(parseInt(id), score, subject?.type || 2);

      // 2. 如果用户已绑定 Bangumi，同步评分到 Bangumi
      if (currentUser.bangumi_bound_at || currentUser.bangumiUsername) {
        try {
          const token = sessionStorage.getItem('acg_jwt_token');
          await fetch(`${API_BASE}/api/bangumi-sync/upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ subjectId: parseInt(id), rating: score, status: null }),
          });
        } catch {
          console.warn('Bangumi 评分同步失败');
        }
      }

      // 3. 刷新社区均分
      const newAvg = await RatingService.getAverageScoreAsync(parseInt(id));
      setAvgScore(newAvg);
    } catch {}
  };

  const toggleFav = async () => {
    if (!isAuthenticated) { openAuth(); return; }
    try {
      const result = await FavoriteService.toggleAsync(currentUser.id, 'info', parseInt(id));
      setIsFav(result.favorited);
    } catch {}
  };

  const loadSubjectComments = useCallback(async () => {
    try {
      setCommentsLoading(true);
      const token = sessionStorage.getItem('acg_jwt_token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/api/subjects/${id}/comments?sort=${sortBy}&limit=100`, { headers });
      if (res.ok) {
        const data = await res.json();
        setLocalComments(data.map(c => ({
          id: c.id,
          userId: c.user_id,
          username: c.username,
          avatar: c.avatar,
          content: c.content,
          likes: c.likes || 0,
          createdAt: new Date(c.created_at).getTime(),
          timestamp: new Date(c.created_at).toLocaleString('zh-CN'),
        })));
      }
    } catch (err) {
      console.warn('[InfoDetail] load comments failed:', err);
      setLocalComments([]);
    } finally {
      setCommentsLoading(false);
    }
  }, [id, sortBy]);

  useEffect(() => { loadSubjectComments(); }, [loadSubjectComments]);

  const handleComment = async () => {
    if (!isAuthenticated) { openAuth(); return; }
    if (!newComment.trim()) return;
    try {
      const token = sessionStorage.getItem('acg_jwt_token');
      const res = await fetch(`${API_BASE}/api/subjects/${id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ content: newComment.trim() }),
      });
      if (res.ok) {
        setNewComment('');
        setActiveTab('comments');
        loadSubjectComments();
      } else {
        const err = await res.json();
        alert(err.error || '发表失败');
      }
    } catch {
      alert('网络错误，请稍后重试');
    }
  };

  const handleCommentLike = async (commentId) => {
    if (!isAuthenticated) { openAuth(); return; }
    try {
      const token = sessionStorage.getItem('acg_jwt_token');
      await fetch(`${API_BASE}/api/subjects/${id}/comments/${commentId}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      });
      setLocalComments(prev => prev.map(c => 
        c.id === commentId ? { ...c, likes: c.likes + 1 } : c
      ));
    } catch {}
  };

  const handleCommentDelete = async (commentId) => {
    if (!isAuthenticated) return;
    if (!confirm('确定要删除这条评论吗？')) return;
    try {
      const token = sessionStorage.getItem('acg_jwt_token');
      const res = await fetch(`${API_BASE}/api/subjects/${id}/comments/${commentId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        setLocalComments(prev => prev.filter(c => c.id !== commentId));
      }
    } catch {}
  };

  const [watchLoading, setWatchLoading] = useState(false);
  const [watchSources, setWatchSources] = useState([]);
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  const [bgFailed, setBgFailed] = useState(false);
  const scrollTimerRef = useRef(null);

  useEffect(() => {
    const handleScroll = () => {
      if (scrollTimerRef.current) return;
      scrollTimerRef.current = setTimeout(() => {
        setScrollY(window.scrollY);
        scrollTimerRef.current = null;
      }, 100);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, []);

  const ANIME_SOURCES = [
    { id: 'internal', name: '站内观看', icon: '🎬', isInternal: true },
    { id: 'bilibili', name: 'Bilibili', icon: '📺', searchUrl: (name) => `https://search.bilibili.com/all?keyword=${encodeURIComponent(name)}` },
    { id: 'acfun', name: 'AcFun', icon: '🎥', searchUrl: (name) => `https://www.acfun.cn/search?keyword=${encodeURIComponent(name)}` },
    { id: 'dmhy', name: '动漫花园', icon: '🌸', searchUrl: (name) => `https://share.dmhy.org/topics/list?keyword=${encodeURIComponent(name)}` },
    { id: 'nyaa', name: 'Nyaa', icon: '🐱', searchUrl: (name) => `https://nyaa.si/?f=0&c=0_0&q=${encodeURIComponent(name)}` },
    { id: 'mikan', name: '蜜柑计划', icon: '🍊', searchUrl: (name) => `https://mikanani.me/Home/Search?searchstr=${encodeURIComponent(name)}` },
    { id: 'acgrip', name: 'ACG.RIP', icon: '🔥', searchUrl: (name) => `https://acg.rip/?term=${encodeURIComponent(name)}` },
  ];

  const GAME_SOURCES = [
    { id: 'steam', name: 'Steam', icon: '🎮', searchUrl: (name) => `https://store.steampowered.com/search/?term=${encodeURIComponent(name)}` },
    { id: 'epic', name: 'Epic Games', icon: '🎯', searchUrl: (name) => `https://store.epicgames.com/zh-CN/browse?q=${encodeURIComponent(name)}` },
    { id: 'gog', name: 'GOG', icon: '💿', searchUrl: (name) => `https://www.gog.com/en/games?query=${encodeURIComponent(name)}` },
    { id: 'tap', name: 'TapTap', icon: '📱', searchUrl: (name) => `https://www.taptap.cn/search/${encodeURIComponent(name)}` },
    { id: 'touchgal', name: 'TouchGal', icon: '🌸', searchUrl: (name) => `https://www.touchgal.ink/search?keyword=${encodeURIComponent(name)}` },
    { id: 'shinnku', name: '真红小站', icon: '🔴', searchUrl: (name) => `https://www.shinnku.com/search?q=${encodeURIComponent(name)}` },
  ];

  const NOVEL_SOURCES = [
    { id: 'amazon', name: 'Amazon', icon: '📚', searchUrl: (name) => `https://www.amazon.co.jp/s?k=${encodeURIComponent(name)}&i=stripbooks` },
    { id: 'kindle', name: 'Kindle', icon: '📖', searchUrl: (name) => `https://www.amazon.co.jp/s?k=${encodeURIComponent(name)}&i=digital-text` },
    { id: 'bookwalker', name: 'BOOKWALKER', icon: '📕', searchUrl: (name) => `https://bookwalker.jp/search/?qcat=&word=${encodeURIComponent(name)}` },
    { id: 'wenku8', name: '轻小说文库', icon: '📝', searchUrl: (name) => `https://www.wenku8.net/modules/article/search.php?searchkey=${encodeURIComponent(name)}` },
  ];

  const handleWatchNow = async () => {
    if (watchLoading) return;
    setWatchLoading(true);
    const typeCode = subject?.type || 2;
    const name = subject?.name_cn || subject?.name || '';
    const nameJp = subject?.name || '';

    let sources = [];
    if (typeCode === 2 || typeCode === 6) {
      sources = ANIME_SOURCES.map(s => ({
        ...s,
        url: s.searchUrl ? s.searchUrl(name || nameJp) : null,
      }));
    } else if (typeCode === 4) {
      sources = GAME_SOURCES.map(s => ({
        ...s,
        url: s.searchUrl ? s.searchUrl(name || nameJp) : null,
      }));
    } else if (typeCode === 1) {
      sources = NOVEL_SOURCES.map(s => ({
        ...s,
        url: s.searchUrl ? s.searchUrl(nameJp || name) : null,
      }));
    }

    if (sources.length > 0) {
      setWatchSources(sources);
      setShowSourcePicker(true);
    } else {
      const typeKey = typeCode === 1 ? 'novel' : typeCode === 4 ? 'game' : 'anime';
      navigate(`/video/subject/${id}`);
    }
    setWatchLoading(false);
  };

  const handleSourceSelect = (source) => {
    if (source.isInternal) {
      setActiveTab('watch');
    } else if (source.url) {
      window.open(source.url, '_blank', 'noopener,noreferrer');
    }
    setShowSourcePicker(false);
  };

  // 站内观看：获取剧集列表
  const fetchWatchEpisodes = useCallback(async () => {
    if (!id) return;
    setWatchEpisodesLoading(true);
    try {
      const eps = await BangumiService.getSubjectEpisodes(id);
      setWatchEpisodes(eps || []);
    } catch (err) {
      console.warn('[InfoDetail] fetch episodes failed:', err);
      setWatchEpisodes([]);
    } finally {
      setWatchEpisodesLoading(false);
    }
  }, [id]);

  // 站内观看：搜索某集的资源（使用 MediaFetcher + MediaSelector）
  const searchMediaForEpisode = useCallback(async (ep) => {
    if (!subject || !ep) return;
    setSelectedEp(ep);
    setMediaSearching(true);
    setMediaSearchError(null);
    setMediaMatches([]);

    try {
      const subjectNames = [];
      if (subject.name_cn) subjectNames.push(subject.name_cn);
      if (subject.name) subjectNames.push(subject.name);

      const request = {
        subjectId: String(subject.id),
        subjectNames,
        episodeSort: String(ep.sort || ep.ep),
        episodeEp: ep.ep ? String(ep.ep) : undefined,
        episodeName: ep.name || '',
      };

      // 使用新的 MediaFetcher API（并发查询 + 增量合并 + 过滤排序）
      const fetcher = mediaSourceManager.createFetcher(request, {
        preference: { allowUnsubtitled: true, hideSingleEpisodeBT: false },
      });

      // 订阅增量结果
      const unsub = fetcher.getSelector().onChange((state) => {
        setMediaMatches(state.included);
      });

      fetcher.start();
      await fetcher.waitForAll();
      unsub();

      const errors = fetcher.getErrors();
      if (errors.length > 0) {
        console.warn('[InfoDetail] media search errors:', errors);
      }
    } catch (err) {
      console.error('[InfoDetail] media search failed:', err);
      setMediaSearchError(err.message || '资源搜索失败');
    } finally {
      setMediaSearching(false);
    }
  }, [subject]);

  // 切换到站内观看/进度标签时自动获取剧集
  useEffect(() => {
    if ((activeTab === 'watch' || activeTab === 'progress') && watchEpisodes.length === 0 && !watchEpisodesLoading) {
      fetchWatchEpisodes();
    }
  }, [activeTab, watchEpisodes.length, watchEpisodesLoading, fetchWatchEpisodes]);

  // wenku8 搜索轻小说
  const searchWenku8 = useCallback(async () => {
    if (!subject) return;
    const name = subject.name_cn || subject.name || '';
    if (!name) return;
    setWenku8Loading(true);
    setWenku8Searched(true);
    try {
      const results = await Wenku8Service.searchNovel(name);
      setWenku8Results(Array.isArray(results) ? results : []);
    } catch (err) {
      console.warn('[InfoDetail] wenku8 search failed:', err);
      setWenku8Results([]);
    } finally {
      setWenku8Loading(false);
    }
  }, [subject]);

  // wenku8 获取章节列表
  const fetchWenku8Chapters = useCallback(async (bookId) => {
    if (!bookId) return;
    setWenku8ChaptersLoading(true);
    try {
      const data = await Wenku8Service.getChapters(bookId);
      setWenku8Chapters(data);
      setWenku8ActiveVolume(0);
    } catch (err) {
      console.warn('[InfoDetail] wenku8 chapters failed:', err);
      setWenku8Chapters(null);
    } finally {
      setWenku8ChaptersLoading(false);
    }
  }, []);

  // wenku8 获取章节正文
  const fetchNovelContent = useCallback(async (chapter) => {
    if (!chapter?.url) return;
    setNovelChapterLoading(true);
    setNovelCurrentChapter(chapter);
    try {
      const data = await Wenku8Service.getChapterContent(chapter.url);
      setNovelChapterContent(data);
      setNovelReading(true);
    } catch (err) {
      console.warn('[InfoDetail] wenku8 content failed:', err);
      setNovelChapterContent({ title: chapter.title, content: '加载失败，请稍后重试' });
    } finally {
      setNovelChapterLoading(false);
    }
  }, []);

  // 切换到轻小说标签时自动搜索
  useEffect(() => {
    if (activeTab === 'novel' && !wenku8Searched && subject?.type === 1) {
      searchWenku8();
    }
  }, [activeTab, wenku8Searched, subject?.type, searchWenku8]);

  // 切换到相关推荐标签时加载推荐数据
  useEffect(() => {
    if (activeTab !== 'recommend' || recommendLoading || (relatedSubjects.length > 0 || similarByTags.length > 0)) return;
    if (!subject?.id) return;

    setRecommendLoading(true);
    (async () => {
      // 1. 同系列作品
      try {
        const related = await BangumiService.getRelatedSubjects(subject.id);
        const filtered = (related || [])
          .filter(r => r.id && r.id !== subject.id)
          .slice(0, 5);
        setRelatedSubjects(filtered);
      } catch {}

      // 2. 相似tag作品
      try {
        const tags = (subject.tags || [])
          .slice()
          .sort((a, b) => (b.count || 0) - (a.count || 0))
          .slice(0, 3)
          .map(t => typeof t === 'string' ? t : t.name)
          .filter(Boolean);

        if (tags.length > 0) {
          const searchTag = tags[0];
          const result = await BangumiService.searchSubjects(searchTag, subject.type || 0, 6, 0);
          const items = (result?.list || [])
            .filter(r => String(r.id) !== String(subject.id))
            .slice(0, 5);
          setSimilarByTags(items);
        }
      } catch {}

      setRecommendLoading(false);
    })();
  }, [activeTab, subject?.id, subject?.tags, subject?.type, recommendLoading, relatedSubjects.length, similarByTags.length]);

  const loadMoreComments = () => {
    const nextPage = bgmCommentsPage + 1;
    setBgmCommentsPage(nextPage);
    fetchBgmComments(nextPage);
  };

  const filteredBgmComments = activeRatingFilter !== null
    ? bgmComments.filter(c => c.score === activeRatingFilter)
    : bgmComments;

  if (loading) {
    return (
      <div className="info-detail-page">
        <div className="detail-loading">
          <div className="detail-loading-progress"><div className="detail-progress-bar" style={{ width: `${progress}%` }} /></div>
          <div className="detail-loading-spinner" />
          <p className="detail-loading-text">正在获取内容信息...</p>
          <p className="detail-loading-hint">{progress < 50 ? '连接 Bangumi API...' : progress < 90 ? '解析内容数据...' : '即将完成...'}</p>
        </div>
      </div>
    );
  }

  if (error) {
    const errCode = error.code || 'UNKNOWN';
    const isOffline = errCode === 'OFFLINE';
    const isNotFound = errCode === 'NOT_FOUND';
    return (
      <div className="info-detail-page">
        <div className="detail-error">
          <div className="detail-error-icon">{isOffline ? '📡' : isNotFound ? '🔍' : '⚠️'}</div>
          <h2 className="detail-error-title">{isOffline ? '网络连接已断开' : isNotFound ? '内容不存在' : '加载失败'}</h2>
          <p className="detail-error-msg">{error.userMessage || error.message}</p>
          <p className="detail-error-hint">{isOffline ? '请检查网络连接后重试' : isNotFound ? '该内容可能已被删除或ID无效' : '请稍后重试，或前往Bangumi查看'}</p>
          <div className="detail-error-actions">
            <button className="detail-error-retry" onClick={fetchDetail}><RefreshCw size={16} /> 重试</button>
            {!isNotFound && <a href={BangumiService.buildBangumiUrl(id)} target="_blank" rel="noopener noreferrer" className="detail-error-bangumi"><ExternalLink size={16} /> 在Bangumi查看</a>}
            <Link to="/wiki" className="detail-error-back"><ArrowLeft size={16} /> 返回禁書目錄</Link>
          </div>
        </div>
      </div>
    );
  }

  if (!subject) return null;

  const subjectType = subject.type || 2;
  const typeKey = BangumiService.getTypeByCode(subjectType);
  const typeLabel = TYPE_LABELS[subjectType] || '其他';
  const TypeIcon = TYPE_ICONS[subjectType] || Tv;
  const coverUrl = subject.images?.large || subject.images?.medium || subject.images?.common || '';
  const score = subject.rating?.score || 0;
  const totalRatings = subject.rating?.total || 0;
  const rank = subject.rank;
  const allChars = characters;
  const mainChars = characters.filter(c => c.role === '主角').slice(0, 8);
  const supportChars = characters.filter(c => c.role !== '主角').slice(0, 12);
  const collection = subject.collection || {};
  const collectionTotal = (collection.wish || 0) + (collection.collect || 0) + (collection.doing || 0) + (collection.on_hold || 0) + (collection.dropped || 0);

  // 按角色分组制作人员
  const staffGroups = groupPersonsByRole(persons);
  const allTags = subject.tags || [];
  const visibleTags = tagsExpanded ? allTags : allTags.slice(0, 10);

  return (
    <div className="info-detail-page animate-fade-in">
      {subject?.images?.large && !bgFailed ? (
        <div 
          className="detail-page-background"
          style={{ backgroundImage: `url(${subject.images.large})`, filter: `blur(${Math.min(30, scrollY * 0.06)}px)`, transform: `scale(${1.02 + Math.min(0.05, scrollY * 0.0001)})` }}
        >
          <img src={subject.images.large} alt="" style={{ display: 'none' }} onError={() => setBgFailed(true)} />
          <div className="detail-bg-overlay" />
        </div>
      ) : (
        <div className="detail-page-background detail-page-bg-fallback">
          <div className="detail-bg-overlay" />
        </div>
      )}
      <div className="detail-hero">
        <h1 className="detail-hero-title" style={{ opacity: Math.max(0, 1 - scrollY / 200), textAlign: 'center', width: '100%' }}>
          <span className="typewriter-text">{displayedTitle}</span>
          {showCursor && <span className="typewriter-cursor">|</span>}
        </h1>
      </div>
      <div 
        className="detail-container"
        style={{
          opacity: scrollY < 50 ? 0 : Math.min(1, Math.max(0, (scrollY - 50) / 150)),
          transform: `translateY(${Math.max(0, 40 - scrollY * 0.4)}px)`,
          transition: 'opacity 0.15s ease, transform 0.15s ease',
        }}
      >
        <div className="detail-breadcrumb">
          <Link to="/wiki" className="breadcrumb-link">禁書目錄</Link>
          <ChevronRight size={14} />
          <span className={`breadcrumb-type type-${typeKey}`}>{typeLabel}</span>
          <ChevronRight size={14} />
          <span className="breadcrumb-current">{subject.name_cn || subject.name}</span>
        </div>

        {/* 左右两栏布局 */}
        <div className="detail-two-column">
          {/* 左侧栏 */}
          <aside className="detail-sidebar">
            <CoverImg src={coverUrl} alt={subject.name_cn || subject.name} />
            
            {/* 评分方块 */}
            <div className="detail-score-box">
              <div className="score-box-main">
                <span className="score-box-num">{score > 0 ? score.toFixed(1) : 'N/A'}</span>
                {score > 0 && (
                  <div className="score-box-stars">
                    {[1,2,3,4,5].map(s => (
                      <Star key={s} size={12} fill={s <= Math.round(score / 2) ? '#ffc107' : 'none'} color={s <= Math.round(score / 2) ? '#ffc107' : 'var(--text-quaternary)'} />
                    ))}
                  </div>
                )}
              </div>
              <div className="score-box-meta">
                <span className="score-box-label">Bangumi 评分</span>
                {totalRatings > 0 && <span className="score-box-count">{totalRatings} 人评分</span>}
                {rank > 0 && <span className="score-box-rank">Rank #{rank}</span>}
              </div>
              <div className="score-box-divider" />
              <div className="score-box-rate">
                <p className="rate-prompt">{userScore ? `我的评分：${userScore}` : '点击评分'}</p>
                <div className="rate-stars">
                  {[1,2,3,4,5,6,7,8,9,10].map(s => (
                    <button key={s} className={`rate-star-btn ${s <= (hoverScore || userScore) ? 'active' : ''}`}
                      onMouseEnter={() => setHoverScore(s)} onMouseLeave={() => setHoverScore(0)} onClick={() => handleRate(s)}>
                      <Star size={14} fill={s <= (hoverScore || userScore) ? '#ffc107' : 'none'} />
                    </button>
                  ))}
                </div>
                {avgScore > 0 && <p className="community-avg">社区均分：{avgScore}</p>}
              </div>
            </div>

            {/* 收藏操作 */}
            <div className="detail-sidebar-actions">
              <button className="detail-watch-btn" onClick={handleWatchNow} disabled={watchLoading}>
                {watchLoading ? <Loader2 size={16} className="vp-spin" /> : <Play size={16} fill="#fff" />}
                {watchLoading ? '正在跳转...' : subject?.type === 4 ? '立即游玩' : '立即观看'}
              </button>
              {showSourcePicker && (
                <div className="detail-source-picker">
                  <h4>{subject?.type === 4 ? '查找游戏' : subject?.type === 1 ? '查找小说' : '选择播放源'}</h4>
                  <p className="detail-source-hint">{subject?.type === 2 || subject?.type === 6 ? '选择站内观看或外部搜索' : '点击将在新标签页打开搜索结果'}</p>
                  <div className="detail-source-list">
                    {watchSources.map(s => (
                      <button key={s.id} className="detail-source-item" onClick={() => handleSourceSelect(s)}>
                        <span className="detail-source-icon">{s.icon}</span>
                        <span className="detail-source-name">{s.name}</span>
                        <ExternalLink size={12} />
                      </button>
                    ))}
                  </div>
                  <button className="detail-source-close" onClick={() => setShowSourcePicker(false)}>取消</button>
                </div>
              )}
              <div className="detail-mark-group">
                {Object.entries(CollectionMarkService.getMarkLabels(subject?.type || 2)).map(([key, label]) => (
                  <button key={key} className={`detail-mark-btn ${collectionMark === key ? `active mark-${key}` : ''}`}
                    onClick={async () => {
                      if (!isAuthenticated) { openAuth(); return; }
                      if (collectionMark === key) {
                        await CollectionMarkService.remove(currentUser.id, parseInt(id));
                        setCollectionMark(null);
                      } else {
                        await CollectionMarkService.upsert({
                          subjectId: parseInt(id),
                          subjectType: subject?.type || 2,
                          subjectName: subject?.name_cn || subject?.name || '',
                          subjectImage: subject?.images?.common || subject?.images?.medium || '',
                          status: key,
                          rating: 0,
                          comment: '',
                        });
                        setCollectionMark(key);
                        behaviorCollector.trackMarkCollection(parseInt(id), key, subject?.type || 2);
                      }
                    }}>{label}</button>
                ))}
              </div>
              <div className="detail-action-row">
                <button className={`detail-action-btn ${isFav ? 'favorited' : ''}`} onClick={toggleFav}>
                  <Bookmark size={15} fill={isFav ? 'var(--primary)' : 'none'} /> {isFav ? '已收藏' : '收藏'}
                </button>
                <button className="detail-action-btn"><Share2 size={15} /> 分享</button>
              </div>
              <a href={BangumiService.buildBangumiUrl(id)} target="_blank" rel="noopener noreferrer" className="detail-action-btn bangumi-link sidebar-bangumi-link">
                <ExternalLink size={15} /> 在Bangumi查看
              </a>
            </div>

            {/* 播放平台 */}
            {platformLinks && platformLinks.length > 0 && (
              <div className="detail-platform-links">
                <h4 className="detail-platform-title">播放平台</h4>
                <div className="detail-platform-list">
                  {platformLinks.map(link => (
                    <a
                      key={link.key}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`detail-platform-btn platform-${link.key}`}
                    >
                      {link.title}
                      {link.regions.length > 0 && (
                        <span className="detail-platform-region">{link.regions.join('/')}</span>
                      )}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* 海外数据 */}
            <div className="detail-overseas-data">
              <h4 className="detail-overseas-title">海外数据</h4>
              {overseasLoading ? (
                <div className="detail-overseas-loading">加载中...</div>
              ) : (
                <>
                  {overseasData?.anilist && (
                    <div className="detail-overseas-source">
                      <span className="detail-overseas-source-name">AniList</span>
                      <div className="detail-overseas-info">
                        {overseasData.anilist.averageScore && (
                          <span className="detail-overseas-score">
                            评分: {(overseasData.anilist.averageScore / 10).toFixed(1)}
                          </span>
                        )}
                        {overseasData.anilist.title?.english && (
                          <span className="detail-overseas-alt-title">
                            EN: {overseasData.anilist.title.english}
                          </span>
                        )}
                        {overseasData.anilist.title?.romaji && (
                          <span className="detail-overseas-alt-title">
                            Roman: {overseasData.anilist.title.romaji}
                          </span>
                        )}
                        {overseasData.anilist.popularity && (
                          <span className="detail-overseas-popularity">
                            人气: #{overseasData.anilist.popularity}
                          </span>
                        )}
                        {overseasData.anilist.siteUrl && (
                          <a href={overseasData.anilist.siteUrl} target="_blank" rel="noopener noreferrer" className="detail-overseas-link">
                            在AniList查看 ↗
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                  {overseasData?.kitsu && (
                    <div className="detail-overseas-source">
                      <span className="detail-overseas-source-name">Kitsu</span>
                      <div className="detail-overseas-info">
                        {overseasData.kitsu.averageRating && (
                          <span className="detail-overseas-score">
                            评分: {(overseasData.kitsu.averageRating / 10).toFixed(1)}
                          </span>
                        )}
                        {overseasData.kitsu.ratingRank && (
                          <span className="detail-overseas-popularity">
                            排名: #{overseasData.kitsu.ratingRank}
                          </span>
                        )}
                        {overseasData.kitsu.siteUrl && (
                          <a href={overseasData.kitsu.siteUrl} target="_blank" rel="noopener noreferrer" className="detail-overseas-link">
                            在Kitsu查看 ↗
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                  {!overseasData?.anilist && !overseasData?.kitsu && !overseasLoading && (
                    <div className="detail-overseas-unavailable">海外数据源暂时不可用</div>
                  )}
                </>
              )}
            </div>

            {/* 收藏统计 */}
            {collectionTotal > 0 && (
              <div className="detail-collection-mini">
                <div className="collection-mini-row"><span className="collection-mini-label">想看</span><span className="collection-mini-num wish">{collection.wish || 0}</span></div>
                <div className="collection-mini-row"><span className="collection-mini-label">看过</span><span className="collection-mini-num collect">{collection.collect || 0}</span></div>
                <div className="collection-mini-row"><span className="collection-mini-label">在看</span><span className="collection-mini-num doing">{collection.doing || 0}</span></div>
                <div className="collection-mini-row"><span className="collection-mini-label">搁置</span><span className="collection-mini-num on-hold">{collection.on_hold || 0}</span></div>
                <div className="collection-mini-row"><span className="collection-mini-label">抛弃</span><span className="collection-mini-num dropped">{collection.dropped || 0}</span></div>
              </div>
            )}

            {/* 评分分布 */}
            {score > 0 && totalRatings > 0 && (
              <div className="detail-rating-mini">
                <VerticalRatingDistribution rating={subject.rating} onFilterChange={setActiveRatingFilter} activeFilter={activeRatingFilter} />
              </div>
            )}
          </aside>

          {/* 右侧主内容区 */}
          <main className="detail-main">
            {/* 标题区 */}
            <div className="detail-title-section">
              <div className="detail-title-row">
                <span className={`detail-type-badge type-${typeKey}`}><TypeIcon size={13} /> {typeLabel}</span>
                {rank > 0 && <span className="detail-rank-badge">Rank #{rank}</span>}
              </div>
              <h1 className="detail-title">{subject.name_cn || subject.name}</h1>
              {subject.name && subject.name !== subject.name_cn && <p className="detail-original-name">{subject.name}</p>}
            </div>

            {/* 限制级内容提示（NSFW 条目） */}
            {isNsfw && (
              <div className="detail-nsfw-notice">
                <ShieldOff size={24} />
                <div>
                  <h3>限制级内容</h3>
                  <p>该内容为限制级内容，详细信息无法显示。请前往 Bangumi 查看完整内容。</p>
                  <p className="detail-nsfw-hint">未来绑定 Bangumi 账号后可直接查看</p>
                </div>
              </div>
            )}

            {/* Tab 区：条目介绍 | 详情 | 角色 | 评论 */}
            <div className="detail-tabs">
              <div className="detail-tabs-header">
                <button className={`detail-tab ${activeTab === 'summary' ? 'active' : ''}`} onClick={() => setActiveTab('summary')}>条目介绍</button>
                <button className={`detail-tab ${activeTab === 'detail' ? 'active' : ''}`} onClick={() => setActiveTab('detail')}>详情</button>
                <button className={`detail-tab ${activeTab === 'characters' ? 'active' : ''}`} onClick={() => setActiveTab('characters')}>出场角色</button>
                <button className={`detail-tab ${activeTab === 'comments' ? 'active' : ''}`} onClick={() => setActiveTab('comments')}>评论区</button>
                {/* 进度标签：仅对动画/三次元类型显示 */}
                {(subject?.type === 2 || subject?.type === 6) && (
                  <button className={`detail-tab ${activeTab === 'progress' ? 'active' : ''}`} onClick={() => setActiveTab('progress')}>进度</button>
                )}
                {/* 字幕组资源标签：仅对动画类型显示 */}
                {subject?.type === 2 && (
                  <button className={`detail-tab ${activeTab === 'fansubs' ? 'active' : ''}`} onClick={() => setActiveTab('fansubs')}>字幕组资源</button>
                )}
                {/* 站内观看标签：仅对动画/三次元类型显示 */}
                {(subject?.type === 2 || subject?.type === 6) && (
                  <button className={`detail-tab ${activeTab === 'watch' ? 'active' : ''}`} onClick={() => setActiveTab('watch')}>站内观看</button>
                )}
                {/* 轻小说标签：仅对小说类型显示 */}
                {subject?.type === 1 && (
                  <button className={`detail-tab ${activeTab === 'novel' ? 'active' : ''}`} onClick={() => setActiveTab('novel')}>轻小说</button>
                )}
                {/* Hikarinagi 下载信息：有关联数据时显示 */}
                {hikarinagiLinked && (
                  <button className={`detail-tab ${activeTab === 'hikarinagi' ? 'active' : ''}`} onClick={() => setActiveTab('hikarinagi')}>
                    <Sparkles size={12} /> 光凪
                  </button>
                )}
                {hikarinagiLoading && (
                  <span className="detail-tab-loading"><Loader2 size={12} className="spinning" /></span>
                )}
                {/* 相关推荐标签 */}
                <button className={`detail-tab ${activeTab === 'recommend' ? 'active' : ''}`} onClick={() => setActiveTab('recommend')}>
                  <Lightbulb size={12} /> 相关推荐
                </button>
              </div>

              <div className="detail-tab-content">
                {/* 详情Tab：infobox + tags + staff */}
                {activeTab === 'detail' && (
                  <div className="detail-detail-section">
                    {isNsfw ? (
                      <div className="detail-no-comments">限制级内容，详细信息不可用</div>
                    ) : (
                      <>
                        {/* 详情信息卡片 */}
                        {subject.infobox && subject.infobox.length > 0 && (
                          <div className="detail-info-card">
                            {subject.infobox.map((item, i) => <InfoBoxItem key={i} item={item} />)}
                          </div>
                        )}
                        {/* 标签区 */}
                        {allTags.length > 0 && (
                          <div className="detail-tags-section">
                            <div className="detail-tags">
                              {visibleTags.map((tag, i) => {
                                const tagName = typeof tag === 'string' ? tag : tag.name;
                                const tagCount = typeof tag === 'object' ? tag.count : null;
                                return (
                                  <span key={i} className="detail-tag">
                                    {tagName}
                                    {tagCount && <span className="detail-tag-count">{tagCount}</span>}
                                  </span>
                                );
                              })}
                            </div>
                            {allTags.length > 10 && (
                              <button className="detail-tags-toggle" onClick={() => setTagsExpanded(!tagsExpanded)}>
                                {tagsExpanded ? <><ChevronUp size={14} /> 收起</> : <><ChevronDown size={14} /> 显示更多 ({allTags.length})</>}
                              </button>
                            )}
                          </div>
                        )}
                        {/* 制作人员（按角色分组） */}
                        {persons.length > 0 && (
                          <div className="detail-staff-section">
                            <h2 className="detail-section-title">制作人员</h2>
                            <div className="detail-staff-groups">
                              {Object.entries(staffGroups).map(([role, members]) => (
                                <StaffGroup key={role} role={role} members={members} defaultCollapsed={members.length > 6} />
                              ))}
                            </div>
                          </div>
                        )}
                        {subject.infobox?.length === 0 && allTags.length === 0 && persons.length === 0 && (
                          <div className="detail-no-comments">暂无详细信息</div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* 简介Tab */}
                {activeTab === 'summary' && (
                  <div className="detail-summary-section">
                    {isNsfw ? (
                      <div className="detail-summary-text" style={{ color: 'var(--text-quaternary)', fontStyle: 'italic' }}>
                        限制级内容，详细信息不可用
                      </div>
                    ) : (
                      <div className="detail-summary-text"><MarkdownRenderer content={subject.summary || '暂无简介'} /></div>
                    )}
                  </div>
                )}

                {/* 角色Tab */}
                {activeTab === 'characters' && (
                  <div className="detail-chars-section">
                    {isNsfw ? (
                      <div className="detail-no-comments">限制级内容，角色信息不可用</div>
                    ) : charsLoading ? (
                      <div className="detail-loading-inline"><Loader2 size={20} className="vp-spin" /> 加载角色中...</div>
                    ) : allChars.length === 0 ? (
                      <div className="detail-no-comments">暂无角色信息</div>
                    ) : (
                      <>
                        {mainChars.length > 0 && (
                          <div className="detail-chars-group">
                            <h3 className="detail-chars-group-title">主角</h3>
                            <div className="detail-chars-grid">
                              {mainChars.map((c, i) => {
                                const charImg = c.images?.medium || c.images?.grid || '';
                                return (
                                  <div key={c.id || i} className="detail-char-card">
                                    {charImg ? <AvatarImg src={charImg} alt={c.name} size={48} /> : <div className="detail-char-avatar-placeholder">{(c.name || '?')[0]}</div>}
                                    <div className="detail-char-info"><span className="detail-char-name">{c.name}</span>{c.role && <span className="detail-char-role">{c.role}</span>}</div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {supportChars.length > 0 && (
                          <div className="detail-chars-group">
                            <h3 className="detail-chars-group-title">配角</h3>
                            <div className="detail-chars-grid">
                              {supportChars.map((c, i) => {
                                const charImg = c.images?.medium || c.images?.grid || '';
                                return (
                                  <div key={c.id || i} className="detail-char-card">
                                    {charImg ? <AvatarImg src={charImg} alt={c.name} size={48} /> : <div className="detail-char-avatar-placeholder">{(c.name || '?')[0]}</div>}
                                    <div className="detail-char-info"><span className="detail-char-name">{c.name}</span>{c.role && <span className="detail-char-role">{c.role}</span>}</div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* 评论Tab */}
                {activeTab === 'comments' && (
                  <div className="detail-comments-section">
                    <div className="comment-subtabs">
                      <button className={`comment-subtab ${commentSubTab === 'local' ? 'active' : ''}`} onClick={() => setCommentSubTab('local')}>站内评论</button>
                      <button className={`comment-subtab ${commentSubTab === 'bgmReviews' ? 'active' : ''}`} onClick={() => setCommentSubTab('bgmReviews')}>Bangumi评论</button>
                      <button className={`comment-subtab ${commentSubTab === 'bgmComments' ? 'active' : ''}`} onClick={() => setCommentSubTab('bgmComments')}>Bangumi吐槽</button>
                    </div>

                    {commentSubTab === 'local' && (
                      <>
                        <div className="detail-comment-form">
                          <textarea placeholder="写下你的评论..." value={newComment} onChange={e => setNewComment(e.target.value)} rows={3} />
                          <button className="comment-submit" onClick={handleComment} disabled={!newComment.trim()}><Send size={14} /> 发表评论</button>
                        </div>
                        <div className="detail-comments-toolbar">
                          <div className="detail-comments-sort">
                            <span className="sort-label">排序:</span>
                            <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="sort-select">
                              <option value="latest">最新</option>
                              <option value="hottest">最热</option>
                            </select>
                          </div>
                        </div>
                        {commentsLoading ? (
                          <div className="detail-no-comments"><Loader2 size={18} className="vp-spin" /> 加载评论中...</div>
                        ) : (
                          <div className="detail-comments-list">
                            {localComments.length === 0 ? (
                              <div className="detail-no-comments">暂无评论，快来发表第一条评论吧！</div>
                            ) : (
                              localComments.map(c => (
                                <div key={c.id} className="detail-comment-item">
                                  <AvatarImg src={c.avatar} alt={c.username} size={36} />
                                  <div className="comment-body">
                                    <div className="comment-header">
                                      <span className="comment-name">{c.username}</span>
                                      <span className="comment-time">{c.timestamp}</span>
                                    </div>
                                    <p className="comment-content">{c.content}</p>
                                    <div className="comment-actions">
                                      <button className="comment-action-btn like" onClick={() => handleCommentLike(c.id)}>
                                        <Heart size={14} /> {c.likes}
                                      </button>
                                      {currentUser && c.userId === currentUser.id && (
                                        <button className="comment-action-btn report" onClick={() => handleCommentDelete(c.id)}>
                                          <AlertCircle size={14} /> 删除
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </>
                    )}

                    {commentSubTab === 'bgmReviews' && (
                      <div className="detail-comments-list">
                        {bgmReviewsLoading ? (
                          <div className="detail-no-comments"><Loader2 size={18} className="vp-spin" /> 加载中...</div>
                        ) : bgmReviews.length === 0 ? (
                          <div className="detail-no-comments">暂无 Bangumi 长评</div>
                        ) : (
                          <>
                            {bgmReviews.map(r => (
                              <div key={r.id} className="detail-comment-item bgm-review-card" onClick={() => r.entryId && window.open(`https://bgm.tv/blog/${r.entryId}`, '_blank')}>
                                <AvatarImg src={r.avatar} alt={r.username} size={36} />
                                <div className="comment-body">
                                  <div className="comment-header">
                                    <span className="comment-name">{r.username}</span>
                                    <span className="comment-time">{r.createdAt}</span>
                                  </div>
                                  <p className="bgm-review-title">{r.title}</p>
                                  <p className="bgm-review-summary">{r.summary}</p>
                                  <div className="comment-actions">
                                    <span className="bgm-review-replies">💬 {r.replies} 回复</span>
                                  </div>
                                </div>
                              </div>
                            ))}
                            {bgmReviewsHasMore && (
                              <button className="load-more-btn" onClick={loadMoreReviews}>加载更多</button>
                            )}
                          </>
                        )}
                      </div>
                    )}

                    {commentSubTab === 'bgmComments' && (
                      <div className="bgm-chat-bubbles">
                        {bgmCommentsLoading ? (
                          <div className="detail-no-comments"><Loader2 size={18} className="vp-spin" /> 加载中...</div>
                        ) : bgmComments.length === 0 ? (
                          <div className="detail-no-comments">暂无 Bangumi 吐槽</div>
                        ) : (
                          <>
                            {bgmComments.map((c, idx) => (
                              <div key={c.id} className={`chat-bubble-row ${idx % 2 === 0 ? 'left' : 'right'}`}>
                                <AvatarImg src={c.avatar} alt={c.username} size={32} />
                                <div className="chat-bubble-content">
                                  <span className="chat-bubble-name">{c.username}</span>
                                  <div className="chat-bubble">
                                    {c.score > 0 && <span className="chat-bubble-score">⭐{c.score}</span>}
                                    <span className="chat-bubble-text">{c.content}</span>
                                  </div>
                                  <span className="chat-bubble-time">{c.createdAt}</span>
                                </div>
                              </div>
                            ))}
                            {bgmCommentsHasMore && (
                              <button className="load-more-btn" onClick={loadMoreComments}>加载更多</button>
                            )}
                          </>
                        )}
                      </div>
                    )}

                  </div>
                )}

                {/* 进度 Tab */}
                {activeTab === 'progress' && (
                  <EpisodeProgressTab
                    subjectId={id}
                    subjectType={subject?.type}
                    episodes={watchEpisodes}
                    episodesLoading={watchEpisodesLoading}
                    fetchEpisodes={fetchWatchEpisodes}
                    user={currentUser}
                    API_BASE={API_BASE}
                    collectionMark={collectionMark}
                    onAutoMark={async (status) => {
                      try {
                        await CollectionMarkService.upsert({
                          subjectId: parseInt(id),
                          subjectType: subject?.type || 2,
                          subjectName: subject?.name_cn || subject?.name || '',
                          subjectImage: subject?.images?.common || subject?.images?.medium || '',
                          status,
                          rating: 0,
                          comment: '',
                        });
                        setCollectionMark(status);
                      } catch (err) {
                        console.warn('[EpisodeProgress] auto mark failed:', err);
                      }
                    }}
                  />
                )}

                {/* 站内观看 Tab */}
                {activeTab === 'watch' && (
                  <div className="watch-tab-layout">
                    {/* 左侧：资源搜索结果 */}
                    <div className="watch-resources">
                      <div className="resources-header">
                        <div className="resources-title">
                          <Search size={16} /> 资源搜索
                          {selectedEp && <span className="resources-ep-badge">第{selectedEp.sort || selectedEp.ep}话</span>}
                        </div>
                      </div>

                      {/* 未选择剧集 */}
                      {!selectedEp && !mediaSearching && (
                        <div className="resources-empty">
                          <div className="resources-empty-icon">📺</div>
                          <div className="resources-empty-text">选择剧集开始搜索</div>
                          <div className="resources-empty-hint">从右侧剧集列表中选择一集</div>
                        </div>
                      )}

                      {/* 搜索中 */}
                      {mediaSearching && (
                        <div className="resources-loading">
                          <div className="loading-spinner"></div>
                          正在搜索资源...
                        </div>
                      )}

                      {/* 搜索错误 */}
                      {mediaSearchError && (
                        <div className="resources-empty">
                          <AlertCircle size={32} style={{color: 'var(--error)', marginBottom: 8}} />
                          <div className="resources-empty-text">{mediaSearchError}</div>
                        </div>
                      )}

                      {/* 搜索结果 */}
                      {!mediaSearching && mediaMatches.length > 0 && (() => {
                        // 按源分组
                        const groups = {};
                        mediaMatches.forEach(m => {
                          const sid = m.media.sourceId;
                          if (!groups[sid]) groups[sid] = { sourceId: sid, name: sid, items: [] };
                          groups[sid].items.push(m);
                        });
                        const sourceColors = {
                          lizi: 'linear-gradient(135deg,#e886a2,#a855f7)',
                          feisu: 'linear-gradient(135deg,#667eea,#764ba2)',
                          bfzy: 'linear-gradient(135deg,#4ecdc4,#44b09e)',
                          kuaikan: 'linear-gradient(135deg,#f093fb,#f5576c)',
                          ffzy: 'linear-gradient(135deg,#4facfe,#00f2fe)',
                          '919dm': 'linear-gradient(135deg,#ff9a9e,#fad0c4)',
                          age: 'linear-gradient(135deg,#a18cd1,#fbc2eb)',
                          dmhy: 'linear-gradient(135deg,#ffe66d,#f9a825)',
                          mikan: 'linear-gradient(135deg,#ff9a9e,#fecfef)',
                          acgrip: 'linear-gradient(135deg,#89f7fe,#66a6ff)',
                          nyaa: 'linear-gradient(135deg,#fddb92,#d1fdff)',
                          breadio: 'linear-gradient(135deg,#c3cfe2,#f5f7fa)',
                          local_cache: 'linear-gradient(135deg,#a8edea,#fed6e3)',
                        };
                        const sourceNames = {
                          lizi: '量子资源', feisu: '飞速资源', bfzy: '暴风资源',
                          kuaikan: '快看资源', ffzy: '非凡资源', '919dm': '樱花动漫',
                          age: 'AGE动漫', dmhy: '动漫花园', mikan: '蜜柑计划',
                          acgrip: 'ACG.RIP', nyaa: 'Nyaa', breadio: 'Breadio',
                          local_cache: '本地缓存',
                        };
                        const isBT = (m) => m.media.download?.kind === 'torrent' || m.media.download?.kind === 'magnet' || m.media.kind === MediaSourceKind.BITTORRENT;
                        const copyToClipboard = (text) => {
                          navigator.clipboard.writeText(text).then(() => {
                            // 简单提示
                            const btn = document.activeElement;
                            if (btn) { btn.textContent = '已复制!'; setTimeout(() => { btn.textContent = '复制链接'; }, 1500); }
                          }).catch(() => {});
                        };
                        return Object.values(groups).map(g => (
                          <div key={g.sourceId} className="source-group">
                            <div className="source-group-header">
                              <div className="source-group-icon" style={{background: sourceColors[g.sourceId] || 'var(--primary)'}}>
                                {(sourceNames[g.sourceId] || g.sourceId)[0]}
                              </div>
                              <span className="source-group-name">{sourceNames[g.sourceId] || g.sourceId}</span>
                              <span className="source-group-count">{g.items.length}条</span>
                            </div>
                            <div className="source-group-items">
                              {g.items.map((m, i) => {
                                const bt = isBT(m);
                                const playUrl = `/video/play/${subject.id}/${selectedEp?.sort || selectedEp?.ep || 1}`;
                                return (
                                  <div key={i} className="source-item" onClick={() => {
                                    if (m.media.download?.url) {
                                      navigate(playUrl, {
                                        state: { media: m.media, episode: selectedEp, subject }
                                      });
                                    }
                                  }}>
                                    <span className={`match-badge ${m.matchKind === MatchKind.EXACT ? 'exact' : 'fuzzy'}`}>
                                      {m.matchKind === MatchKind.EXACT ? '精确' : '模糊'}
                                    </span>
                                    <span className="source-item-title">{m.media.title}</span>
                                    <div className="source-item-props">
                                      {!bt && <span className="prop-tag prop-online">在线</span>}
                                      {bt && <span className="prop-tag prop-bt">BT</span>}
                                      {m.media.properties?.resolution && <span className="prop-tag">{m.media.properties.resolution}</span>}
                                      {m.media.properties?.alliance && <span className="prop-tag">{m.media.properties.alliance}</span>}
                                    </div>
                                    <button className="play-btn">▶ 播放</button>
                                    {bt && (
                                      <button className="play-btn copy-btn" onClick={(e) => { e.stopPropagation(); copyToClipboard(m.media.download?.url || ''); }}>
                                        复制链接
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ));
                      })()}

                      {/* 无结果 */}
                      {!mediaSearching && selectedEp && mediaMatches.length === 0 && !mediaSearchError && (
                        <div className="resources-empty">
                          <div className="resources-empty-icon">🔍</div>
                          <div className="resources-empty-text">未找到可用资源</div>
                          <div className="resources-empty-hint">尝试选择其他剧集</div>
                        </div>
                      )}
                    </div>

                    {/* 右侧：剧集列表 */}
                    <div className="watch-episodes">
                      <div className="ep-sidebar-header">
                        剧集 <span className="ep-count">{watchEpisodes.length}话</span>
                      </div>
                      {watchEpisodesLoading ? (
                        <div className="resources-loading" style={{padding: '24px 12px'}}>
                          <div className="loading-spinner"></div>
                        </div>
                      ) : (
                        <div className="ep-list">
                          {watchEpisodes.map((ep, i) => (
                            <div
                              key={ep.id || i}
                              className={`ep-item ${selectedEp?.id === ep.id ? 'active' : ''}`}
                              onClick={() => searchMediaForEpisode(ep)}
                            >
                              <span className="ep-num">{ep.sort || ep.ep || i + 1}</span>
                              <span className="ep-title">{ep.name || `第${ep.sort || ep.ep || i + 1}话`}</span>
                            </div>
                          ))}
                          {watchEpisodes.length === 0 && (
                            <div style={{padding: '20px 12px', textAlign: 'center', color: 'var(--text-quaternary)', fontSize: 13}}>
                              暂无剧集信息
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 字幕组资源 Tab */}
                {activeTab === 'fansubs' && (
                  <FansubGroupsPanel bgmId={id} />
                )}

                {/* 轻小说 Tab：EPUB下载 + 在线阅读 */}
                {activeTab === 'novel' && (
                  <div className="novel-tab-layout">
                    {/* 在线阅读模式 */}
                    {novelReading ? (
                      <div className="novel-reader-embedded">
                        <div className="novel-reader-header">
                          <button className="novel-reader-back" onClick={() => setNovelReading(false)}>
                            <ArrowLeft size={16} /> 返回目录
                          </button>
                          <span className="novel-reader-title">{novelCurrentChapter?.title || ''}</span>
                        </div>
                        <div className="novel-reader-content">
                          {novelChapterLoading ? (
                            <div className="novel-reader-loading"><Loader2 size={24} className="vp-spin" /> 加载中...</div>
                          ) : (
                            <div className="novel-reader-text" dangerouslySetInnerHTML={{ __html: novelChapterContent?.content || '' }} />
                          )}
                        </div>
                        {wenku8Chapters && novelCurrentChapter && (() => {
                          const allChapters = wenku8Chapters.volumes.flatMap(v => v.chapters);
                          const curIdx = allChapters.findIndex(c => c.id === novelCurrentChapter.id);
                          return (
                            <div className="novel-reader-nav">
                              <button className="novel-nav-btn" disabled={curIdx <= 0} onClick={() => fetchNovelContent(allChapters[curIdx - 1])}>
                                <ChevronRight size={14} style={{transform:'rotate(180deg)'}} /> 上一章
                              </button>
                              <span className="novel-nav-info">{curIdx >= 0 ? `${curIdx + 1} / ${allChapters.length}` : ''}</span>
                              <button className="novel-nav-btn" disabled={curIdx < 0 || curIdx >= allChapters.length - 1} onClick={() => fetchNovelContent(allChapters[curIdx + 1])}>
                                下一章 <ChevronRight size={14} />
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    ) : (
                      <>
                        {/* EPUB 下载区 */}
                        <div className="novel-section">
                          <h3 className="novel-section-title"><Download size={16} /> EPUB 下载</h3>
                          {wenku8Loading ? (
                            <div className="novel-loading"><Loader2 size={18} className="vp-spin" /> 搜索轻小说资源中...</div>
                          ) : wenku8Results.length === 0 ? (
                            <div className="novel-empty">
                              {wenku8Searched ? '未在轻小说文库找到匹配资源' : '点击搜索轻小说文库资源'}
                              {!wenku8Searched && <button className="novel-search-btn" onClick={searchWenku8}>搜索</button>}
                            </div>
                          ) : (
                            <div className="novel-download-list">
                              {wenku8Results.map((item, i) => (
                                <div key={i} className="novel-download-item">
                                  <div className="novel-download-info">
                                    <span className="novel-download-name">{item.main}{item.alt ? ` (${item.alt})` : ''}</span>
                                    <span className="novel-download-meta">
                                      {item.author && <span className="novel-meta-tag">{item.author}</span>}
                                      {item.volume && <span className="novel-meta-tag">第{item.volume}卷</span>}
                                      {item.dlRemark && <span className="novel-meta-tag">{item.dlRemark}</span>}
                                    </span>
                                  </div>
                                  <div className="novel-download-actions">
                                    {item.downloadUrl && (
                                      <a href={item.downloadUrl} target="_blank" rel="noopener noreferrer" className="novel-dl-btn epub">
                                        <Download size={13} /> EPUB
                                      </a>
                                    )}
                                    {item.dlLabel && item.dlPwd && (
                                      <a href={`https://wwa.lanzoui.com/${item.dlLabel}`} target="_blank" rel="noopener noreferrer" className="novel-dl-btn lanzou">
                                        <Download size={13} /> 蓝奏云
                                        <span className="novel-dl-pwd">密码: {item.dlPwd}</span>
                                      </a>
                                    )}
                                    {item.novelLink && (
                                      <button className="novel-dl-btn read" onClick={() => {
                                        const bookId = Wenku8Service.extractBookId(item.novelLink);
                                        if (bookId) fetchWenku8Chapters(bookId);
                                      }}>
                                        <BookText size={13} /> 在线阅读
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* 章节目录区 */}
                        {wenku8Chapters && (
                          <div className="novel-section">
                            <h3 className="novel-section-title"><BookText size={16} /> {wenku8Chapters.title || '章节目录'}</h3>
                            {wenku8ChaptersLoading ? (
                              <div className="novel-loading"><Loader2 size={18} className="vp-spin" /> 加载章节目录...</div>
                            ) : (
                              <div className="novel-chapters">
                                {/* 卷选择器 */}
                                {wenku8Chapters.volumes?.length > 1 && (
                                  <div className="novel-volume-tabs">
                                    {wenku8Chapters.volumes.map((vol, vi) => (
                                      <button key={vi} className={`novel-volume-tab ${wenku8ActiveVolume === vi ? 'active' : ''}`}
                                        onClick={() => setWenku8ActiveVolume(vi)}>
                                        {vol.name}
                                      </button>
                                    ))}
                                  </div>
                                )}
                                {/* 章节列表 */}
                                <div className="novel-chapter-list">
                                  {wenku8Chapters.volumes?.[wenku8ActiveVolume]?.chapters?.map((ch, ci) => (
                                    <button key={ch.id || ci} className="novel-chapter-item"
                                      onClick={() => fetchNovelContent(ch)}>
                                      {ch.title || `第${ci + 1}章`}
                                    </button>
                                  )) || <div className="novel-empty">该卷暂无章节</div>}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Hikarinagi 补充信息 Tab */}
                {activeTab === 'hikarinagi' && hikarinagiLinked && (
                  <div className="hikarinagi-tab">
                    <div className="hikarinagi-tab-header">
                      <span className="hikarinagi-tab-source">
                        <Sparkles size={14} /> 数据来源：<a
                          className="hikarinagi-tab-source-link"
                          href={hikarinagiLinked.type === 'galgame'
                            ? `https://www.hikarinagi.org/galgame/${hikarinagiLinked.data?.galId || hikarinagiLinked.data?.id}`
                            : `https://www.hikarinagi.org/lightnovel/${hikarinagiLinked.data?.novelId || hikarinagiLinked.data?.id}`}
                          target="_blank" rel="noopener noreferrer"
                        >Hikarinagi（光凪）<ExternalLink size={10} /></a>
                      </span>
                    </div>

                    {/* Hikarinagi 评分 */}
                    {hikarinagiLinked.data?.rate > 0 && (
                      <div className="hikarinagi-tab-score">
                        <Star size={16} fill="#ffc107" />
                        <span>光凪评分：{Number(hikarinagiLinked.data.rate).toFixed(1)}</span>
                      </div>
                    )}

                    {/* 作者信息 */}
                    {hikarinagiLinked.data?.author && (
                      <div className="hikarinagi-tab-info">
                        <h4><BookText size={14} /> 作者</h4>
                        <span>{hikarinagiLinked.data.author.transName || hikarinagiLinked.data.author.name}</span>
                      </div>
                    )}

                    {/* 出版社 / 文库 */}
                    {(hikarinagiLinked.data?.bunko || hikarinagiLinked.data?.publishers?.length > 0) && (
                      <div className="hikarinagi-tab-info">
                        <h4><BookOpen size={14} /> {hikarinagiLinked.type === 'galgame' ? '制作组' : '文库/出版社'}</h4>
                        {hikarinagiLinked.data.bunko && <span className="hikarinagi-tag">{hikarinagiLinked.data.bunko.name}</span>}
                        {hikarinagiLinked.data.publishers?.filter(p => p.name || p.note).map((p, i) => (
                          <span key={i} className="hikarinagi-tag">{p.name || p.note}</span>
                        ))}
                        {hikarinagiLinked.data.producers?.map((p, i) => (
                          <span key={i} className="hikarinagi-tag">{p.producer?.name || p.name}</span>
                        ))}
                      </div>
                    )}

                    {/* 标签 */}
                    {hikarinagiLinked.data?.tags?.length > 0 && (
                      <div className="hikarinagi-tab-info">
                        <h4>标签</h4>
                        <div className="hikarinagi-tags">
                          {hikarinagiLinked.data.tags.slice(0, 15).map((t, i) => (
                            <span key={i} className="hikarinagi-tag">{typeof t === 'string' ? t : t.tag?.name || t.name || t.tag}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 状态 */}
                    {hikarinagiLinked.data?.novelStatus && (
                      <div className="hikarinagi-tab-info">
                        <h4>连载状态</h4>
                        <span className="hikarinagi-tag">{hikarinagiLinked.data.novelStatus === 'SERIALIZING' ? '连载中' : hikarinagiLinked.data.novelStatus === 'COMPLETED' ? '已完结' : hikarinagiLinked.data.novelStatus}</span>
                      </div>
                    )}

                    {/* 简介（如有中文简介） */}
                    {hikarinagiLinked.data?.summary_cn && (
                      <div className="hikarinagi-tab-info">
                        <h4>简介</h4>
                        <p className="hikarinagi-summary">{hikarinagiLinked.data.summary_cn}</p>
                      </div>
                    )}

                    {/* 下载信息（需要认证，可能为空） */}
                    {hikarinagiLinked.downloadInfo ? (
                      <div className="hikarinagi-tab-download">
                        <h4><Download size={14} /> 下载信息</h4>
                        {typeof hikarinagiLinked.downloadInfo === 'string' ? (
                          <div className="hikarinagi-download-content" dangerouslySetInnerHTML={{ __html: hikarinagiLinked.downloadInfo.replace(/\n/g, '<br/>') }} />
                        ) : Array.isArray(hikarinagiLinked.downloadInfo) ? (
                          <div className="hikarinagi-download-list">
                            {hikarinagiLinked.downloadInfo.map((item, i) => (
                              <div key={i} className="hikarinagi-download-item">
                                <span>{item.name || item.title || `资源 ${i + 1}`}</span>
                                {item.url && <a href={item.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} /></a>}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <pre className="hikarinagi-download-raw">{JSON.stringify(hikarinagiLinked.downloadInfo, null, 2)}</pre>
                        )}
                      </div>
                    ) : (
                      <div className="hikarinagi-tab-download-hint">
                        <Download size={14} /> 下载资源需登录光凪账号，请点击上方链接前往查看
                      </div>
                    )}

                    {/* 外部链接 */}
                    {hikarinagiLinked.links && (Array.isArray(hikarinagiLinked.links) ? hikarinagiLinked.links.length > 0 : true) && (
                      <div className="hikarinagi-tab-links">
                        <h4><ExternalLink size={14} /> 外部链接</h4>
                        <div className="hikarinagi-links-list">
                          {(Array.isArray(hikarinagiLinked.links) ? hikarinagiLinked.links : [hikarinagiLinked.links]).map((link, i) => (
                            <a key={i} href={link.url || link} target="_blank" rel="noopener noreferrer" className="hikarinagi-link-item">
                              <ExternalLink size={12} /> {link.name || link.title || `链接 ${i + 1}`}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 相关推荐（已过滤：仅显示能在 Bangumi 搜到的条目） */}
                    {hikarinagiLinked.related && hikarinagiLinked.related.length > 0 && (
                      <div className="hikarinagi-tab-related">
                        <h4><Sparkles size={14} /> 相关推荐</h4>
                        <div className="hikarinagi-related-grid">
                          {hikarinagiLinked.related.map((item, i) => (
                            <Link
                              key={i}
                              to={`/info/${item.bgmSubject?.id}`}
                              className="hikarinagi-related-card"
                            >
                              {item.bgmSubject?.images?.common && (
                                <img src={item.bgmSubject.images.common} alt="" loading="lazy" />
                              )}
                              <span className="hikarinagi-related-name">
                                {item.bgmSubject?.name_cn || item.bgmSubject?.name || item.name || item.name_cn}
                              </span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 相关推荐Tab */}
                {activeTab === 'recommend' && (
                  <div className="detail-recommend-section">
                    {recommendLoading ? (
                      <div className="detail-recommend-loading">
                        <Loader2 size={20} className="spinning" /> 正在加载推荐...
                      </div>
                    ) : (
                      <>
                        {/* 同系列作品 */}
                        {relatedSubjects.length > 0 && (
                          <div className="detail-recommend-group">
                            <h3 className="detail-recommend-title"><Sparkles size={14} /> 同系列作品</h3>
                            <div className="detail-recommend-grid">
                              {relatedSubjects.map(item => {
                                const itemId = item.id || item.subject_id;
                                const itemImage = item.images?.large || item.images?.common || item.image || '';
                                const itemName = item.name_cn || item.name || '';
                                const itemType = item.type || subject?.type || 2;
                                const preview = extractPreview({ ...item, type: itemType });
                                return (
                                  <Link key={itemId} to={`/info/${typeToKey(itemType)}/${itemId}`} state={{ preview }} className="detail-recommend-card">
                                    <div className="detail-recommend-cover">
                                      {itemImage ? (
                                        <img src={itemImage} alt={itemName} loading="lazy" onError={e => { e.target.style.display = 'none'; }} />
                                      ) : (
                                        <div className="detail-recommend-no-img">{itemName.slice(0, 4)}</div>
                                      )}
                                    </div>
                                    <div className="detail-recommend-info">
                                      <div className="detail-recommend-name">{itemName}</div>
                                      {item.relation && <span className="detail-recommend-relation">{item.relation}</span>}
                                    </div>
                                  </Link>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* 相似tag作品 */}
                        {similarByTags.length > 0 && (
                          <div className="detail-recommend-group">
                            <h3 className="detail-recommend-title"><Lightbulb size={14} /> 相似标签作品</h3>
                            <div className="detail-recommend-grid">
                              {similarByTags.map(item => {
                                const itemId = item.id;
                                const itemImage = item.images?.large || item.images?.common || '';
                                const itemName = item.name_cn || item.name || '';
                                const itemType = item.type || subject?.type || 2;
                                const preview = extractPreview(item);
                                return (
                                  <Link key={itemId} to={`/info/${typeToKey(itemType)}/${itemId}`} state={{ preview }} className="detail-recommend-card">
                                    <div className="detail-recommend-cover">
                                      {itemImage ? (
                                        <img src={itemImage} alt={itemName} loading="lazy" onError={e => { e.target.style.display = 'none'; }} />
                                      ) : (
                                        <div className="detail-recommend-no-img">{itemName.slice(0, 4)}</div>
                                      )}
                                    </div>
                                    <div className="detail-recommend-info">
                                      <div className="detail-recommend-name">{itemName}</div>
                                      {item.score > 0 && <span className="detail-recommend-score"><Star size={10} fill="var(--star-color)" /> {Number(item.score).toFixed(1)}</span>}
                                    </div>
                                  </Link>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* 无推荐数据 */}
                        {relatedSubjects.length === 0 && similarByTags.length === 0 && (
                          <div className="detail-no-comments">暂无相关推荐数据</div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
