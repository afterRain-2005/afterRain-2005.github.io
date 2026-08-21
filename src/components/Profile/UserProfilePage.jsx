import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { FriendService, FollowService, CollectionMarkService, UserService, MailService, BangumiAuthService, GitHubAuthService, StorageService, UserGuestbookService, ForumService, NewsService } from '../../services/api';
import { extractPreview } from '../../utils/subjectType';
import { Calendar, MapPin, Heart, LinkIcon, Shield, ShieldOff, BookOpen, UserPlus, UserCheck, UserX, MessageCircle, MoreHorizontal, Star, Users, Activity, MessageSquare, Loader2, Edit3, Settings, Camera, Mail, Smile, Lock, Globe, Search, Newspaper, Send, Trash2, Database, HardDrive, Download, Upload, Sparkles, MousePointerClick, Feather } from 'lucide-react';
import { SubjectCard } from '../Common/CommonComponents';
import { MarkdownRenderer } from '../Common/MarkdownEditor/MarkdownEditor';
import ActivityHeatmap from './ActivityHeatmap';
import CreativeSpace from './Creative/CreativeSpace.jsx';
import './UserProfilePage.css';
import { isFireworkOn, setFireworkOn } from '../Common/FireworkEffect';
import { isClickTextOn, setClickTextOn } from '../Common/ClickTextEffect';

const FALLBACK_IMG = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="40" height="40" fill="%23f9f3f5"%3E%3Crect width="40" height="40" rx="20"/%3E%3Ctext x="20" y="24" text-anchor="middle" fill="%23c8bfcc" font-size="12"%3E%3F%3C/text%3E%3C/svg%3E';
const MARK_COLORS = { wish: '#409eff', collect: '#e6a23c', doing: '#67c23a', on_hold: '#909399', dropped: '#f56c6c' };

// 动词 → subject_type 映射：看→动画(2), 读→书籍(1), 玩→游戏(4)；三次元(6)归入动画
const STATUS_VERBS = {
  wish: [{ verb: '想看', type: 2 }, { verb: '想读', type: 1 }, { verb: '想玩', type: 4 }],
  doing: [{ verb: '在看', type: 2 }, { verb: '在读', type: 1 }, { verb: '在玩', type: 4 }],
  collect: [{ verb: '看过', type: 2 }, { verb: '读过', type: 1 }, { verb: '玩过', type: 4 }],
};

const PRIVACY_OPTIONS = [
  { key: 'public', label: '公开', icon: Globe, desc: '所有人可见' },
  { key: 'friends', label: '仅好友', icon: UserCheck, desc: '仅好友可见' },
  { key: 'private', label: '私密', icon: Lock, desc: '仅自己可见' },
];

const GitHubIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
  </svg>
);

export default function UserProfilePage() {
  const { userId: urlUserId } = useParams();
  const navigate = useNavigate();
  const { currentUser, isAuthenticated, openAuth, updateProfile, socialMode, filterNsfw, toggleFilterNsfw } = useApp();

  // 如果没有 URL 参数（/profile 路由），使用当前用户 ID
  const effectiveUserId = urlUserId || (currentUser?.id);
  const isSelf = !urlUserId || (currentUser && currentUser.id === parseInt(urlUserId));

  // ─── 基础状态 ───
  const [userInfo, setUserInfo] = useState(null);
  const [friendStatus, setFriendStatus] = useState(null); // 'none' | 'pending_sent' | 'pending_received' | 'accepted' | 'rejected' | 'following'
  const [friendRequestId, setFriendRequestId] = useState(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [userMarks, setUserMarks] = useState([]);
  const [markCounts, setMarkCounts] = useState({ wish: 0, collect: 0, doing: 0, on_hold: 0, dropped: 0 });
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  // ─── 社交列表状态 ───
  const [socialTab, setSocialTab] = useState(null); // null | 'following' | 'followers' | 'friends'
  const [socialList, setSocialList] = useState([]);
  const [socialLoading, setSocialLoading] = useState(false);
  const [requestMessage, setRequestMessage] = useState('');
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState({}); // { wish: 2, collect: 1 } — 按 subject_type 筛选，null/undefined 表示全部
  const [expandedSections, setExpandedSections] = useState({});
  const [activityData, setActivityData] = useState([]);
  const [userComments, setUserComments] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);

  // ─── 自有主页状态 ───
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [avatarPreview, setAvatarPreview] = useState(null);
  const avatarInputRef = useRef(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState('profile');
  const [fireworkEnabled, setFireworkEnabled] = useState(() => isFireworkOn());
  const [clickTextEnabled, setClickTextEnabled] = useState(() => isClickTextOn());
  const [dataSettings, setDataSettings] = useState(() => {
    const saved = StorageService.get('acg_data_settings');
    return saved || { auto_enrich: true, local_backup: false };
  });
  const [privacySettings, setPrivacySettings] = useState(() => {
    const prefs = StorageService.get('acg_current_user')?.preferences;
    return prefs?.privacy || StorageService.get('acg_privacy') || { profile: 'public', marks: 'public', info: 'public' };
  });
  const [unreadMail, setUnreadMail] = useState(0);

  // ─── 好友标签页状态 ───
  const [activeTab, setActiveTab] = useState('collections');
  const [friendList, setFriendList] = useState([]);
  const [receivedRequests, setReceivedRequests] = useState([]);
  const [sentRequests, setSentRequests] = useState([]);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // ─── 留言板状态 ───
  const [guestbookMessages, setGuestbookMessages] = useState([]);
  const [guestbookLoading, setGuestbookLoading] = useState(false);
  const [guestbookInput, setGuestbookInput] = useState('');
  const [guestbookSubmitting, setGuestbookSubmitting] = useState(false);
  // ─── Bangumi 导入状态 ───
  const [bangumiImporting, setBangumiImporting] = useState(false);
  const [bangumiImportResult, setBangumiImportResult] = useState(null);
  const [bangumiOverwrite, setBangumiOverwrite] = useState(false);
  // ─── Bangumi 上传同步状态 ───
  const [bangumiUploading, setBangumiUploading] = useState(false);
  const [bangumiUploadResult, setBangumiUploadResult] = useState(null);

  // ─── 发帖/资讯状态 ───
  const [userPosts, setUserPosts] = useState([]);
  const [userNews, setUserNews] = useState([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [newsLoading, setNewsLoading] = useState(false);

  // ─── 加载用户信息 ───
  useEffect(() => {
    const loadUser = async () => {
      // 自己的主页：直接使用 currentUser，无需调 API
      if (isSelf && currentUser) {
        setUserInfo(currentUser);
        setLoading(false);
        return;
      }
      if (!effectiveUserId) { setLoading(false); return; }
      setLoading(true);
      try {
        const data = await FriendService.getUserPublic(effectiveUserId);
        setUserInfo(data);
      } catch {
        setUserInfo(null);
      } finally {
        setLoading(false);
      }
    };
    loadUser();
  }, [effectiveUserId, isSelf, currentUser]);

  // ─── 加载好友状态和关注状态（仅他人主页） ───
  useEffect(() => {
    if (!isAuthenticated || !currentUser || isSelf) return;
    const loadStatus = async () => {
      try {
        const status = await FriendService.getFriendStatus(effectiveUserId);
        // 后端返回 requestStatus: 'none' | 'pending_sent' | 'pending_received' | 'accepted' | 'rejected'
        // 以及 isFollowing, isFollower, requestId
        if (status.requestStatus === 'accepted') {
          setFriendStatus('accepted');
        } else if (status.requestStatus === 'pending_sent' || status.requestStatus === 'pending_received') {
          setFriendStatus(status.requestStatus);
        } else if (status.isFollowing) {
          setFriendStatus('following');
        } else {
          setFriendStatus('none');
        }
        setFriendRequestId(status.requestId || null);
      } catch {
        setFriendStatus('none');
      }
      try {
        const following = await FollowService.isFollowingAsync(currentUser.id, parseInt(effectiveUserId));
        setIsFollowing(following);
      } catch {}
    };
    loadStatus();
  }, [isAuthenticated, currentUser, effectiveUserId, isSelf]);

  // ─── 加载用户收藏 ───
  useEffect(() => {
    if (!effectiveUserId) return;
    // 自己的主页始终加载；他人主页需 allow_profile_view
    if (!isSelf && !userInfo?.allow_profile_view) return;
    const loadMarks = async () => {
      try {
        const marks = await CollectionMarkService.getByUserId(parseInt(effectiveUserId));
        const list = Array.isArray(marks) ? marks : [];
        setUserMarks(list);
        const counts = { wish: 0, collect: 0, doing: 0, on_hold: 0, dropped: 0 };
        list.forEach(m => { if (counts[m.status] !== undefined) counts[m.status]++; });
        setMarkCounts(counts);
      } catch {}
    };
    loadMarks();
  }, [userInfo, effectiveUserId, isSelf]);

  // ─── 加载活跃度热力图 ───
  useEffect(() => {
    if (!effectiveUserId) return;
    if (!isSelf && !userInfo?.allow_profile_view) return;
    setActivityLoading(true);
    UserService.getUserActivity(parseInt(effectiveUserId))
      .then(data => setActivityData(Array.isArray(data) ? data : []))
      .catch(() => setActivityData([]))
      .finally(() => setActivityLoading(false));
  }, [userInfo, effectiveUserId, isSelf]);

  // ─── 加载用户评论 ───
  useEffect(() => {
    if (!effectiveUserId) return;
    if (!isSelf && !userInfo?.allow_profile_view) return;
    setCommentsLoading(true);
    UserService.getUserComments(parseInt(effectiveUserId))
      .then(data => setUserComments(Array.isArray(data) ? data : []))
      .catch(() => setUserComments([]))
      .finally(() => setCommentsLoading(false));
  }, [userInfo, effectiveUserId, isSelf]);

  // ─── 加载未读邮件数（仅自己主页） ───
  useEffect(() => {
    if (!isSelf || !currentUser) return;
    MailService.getUnreadCountAsync(currentUser.id).then(data => {
      setUnreadMail(typeof data === 'object' ? data.unread : (data || 0));
    }).catch(() => {});
  }, [isSelf, currentUser]);

  // ─── 加载好友列表和请求（仅自己主页） ───
  useEffect(() => {
    if (!isSelf || !currentUser) return;
    const loadFriendData = async () => {
      try {
        const friends = await FriendService.getFriendList();
        setFriendList(Array.isArray(friends) ? friends : (friends?.list || []));
      } catch {}
      try {
        const received = await FriendService.getReceivedRequests();
        setReceivedRequests(Array.isArray(received) ? received : []);
      } catch {}
      try {
        const sent = await FriendService.getSentRequests();
        setSentRequests(Array.isArray(sent) ? sent : []);
      } catch {}
    };
    loadFriendData();
  }, [isSelf, currentUser]);

  // ─── 加载留言板 ───
  useEffect(() => {
    if (!effectiveUserId) return;
    if (!isSelf && !userInfo?.allow_guestbook) return;
    setGuestbookLoading(true);
    UserGuestbookService.getMessages(parseInt(effectiveUserId))
      .then(data => {
        const msgs = data?.messages || data || [];
        setGuestbookMessages(Array.isArray(msgs) ? msgs : []);
      })
      .catch(() => setGuestbookMessages([]))
      .finally(() => setGuestbookLoading(false));
  }, [effectiveUserId, userInfo?.allow_guestbook]);

  // ─── 加载用户发帖 ───
  useEffect(() => {
    if (!effectiveUserId) return;
    if (!isSelf && !userInfo?.show_posts) return;
    setPostsLoading(true);
    ForumService.getPosts(1, 10, '', 'latest', effectiveUserId)
      .then(data => setUserPosts(data?.posts || []))
      .catch(() => setUserPosts([]))
      .finally(() => setPostsLoading(false));
  }, [effectiveUserId, userInfo?.show_posts]);

  // ─── 加载用户资讯 ───
  useEffect(() => {
    if (!effectiveUserId) return;
    if (!isSelf && !userInfo?.show_news) return;
    setNewsLoading(true);
    NewsService.getCustomNews(1, 10, effectiveUserId)
      .then(data => setUserNews(data?.news || []))
      .catch(() => setUserNews([]))
      .finally(() => setNewsLoading(false));
  }, [effectiveUserId, userInfo?.show_news]);

  // ─── 计算属性 ───
  const totalMarks = userMarks.length;
  const avgScore = useMemo(() => {
    const scores = userMarks.filter(m => (m.rating || m.user_score) > 0).map(m => m.rating || m.user_score);
    return scores.length > 0 ? (scores.reduce((s, v) => s + v, 0) / scores.length).toFixed(1) : '-';
  }, [userMarks]);

  const progressData = useMemo(() => {
    const total = totalMarks || 1;
    return [
      { key: 'wish', count: markCounts.wish, color: MARK_COLORS.wish, label: '想看' },
      { key: 'collect', count: markCounts.collect, color: MARK_COLORS.collect, label: '看过' },
      { key: 'doing', count: markCounts.doing, color: MARK_COLORS.doing, label: '在看' },
      { key: 'on_hold', count: markCounts.on_hold, color: MARK_COLORS.on_hold, label: '搁置' },
      { key: 'dropped', count: markCounts.dropped, color: MARK_COLORS.dropped, label: '抛弃' },
    ].filter(d => d.count > 0);
  }, [markCounts, totalMarks]);

  // 切换分类筛选：点击选中对应类型，再点击取消（显示全部）
  const toggleCategoryFilter = useCallback((status, type) => {
    setCategoryFilter(prev => ({ ...prev, [status]: prev[status] === type ? null : type }));
  }, []);

  // ─── 他人主页：好友操作 ───
  const handleSendRequest = async () => {
    if (!isAuthenticated) { openAuth(); return; }
    setActionLoading(true);
    try {
      await FriendService.sendFriendRequest(parseInt(effectiveUserId), requestMessage);
      setFriendStatus('pending_sent');
      setShowRequestModal(false);
      setRequestMessage('');
    } catch (err) {
      alert(err.message || '发送好友请求失败');
    } finally {
      setActionLoading(false);
    }
  };

  const handleAcceptRequest = async () => {
    if (!isAuthenticated) return;
    setActionLoading(true);
    try {
      // 使用已缓存的 requestId，若无则重新查询
      let requestId = friendRequestId;
      if (!requestId) {
        const status = await FriendService.getFriendStatus(effectiveUserId);
        requestId = status.requestId;
      }
      if (requestId) {
        await FriendService.handleFriendRequest(requestId, 'accepted');
        setFriendStatus('accepted');
        setFriendRequestId(requestId);
      }
    } catch (err) {
      alert(err.message || '操作失败');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectRequest = async () => {
    if (!isAuthenticated) return;
    setActionLoading(true);
    try {
      let requestId = friendRequestId;
      if (!requestId) {
        const status = await FriendService.getFriendStatus(effectiveUserId);
        requestId = status.requestId;
      }
      if (requestId) {
        await FriendService.handleFriendRequest(requestId, 'rejected');
        setFriendStatus('none');
        setFriendRequestId(null);
      }
    } catch (err) {
      alert(err.message || '操作失败');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveFriend = async () => {
    if (!isAuthenticated) return;
    if (!confirm('确定要删除好友吗？')) return;
    setActionLoading(true);
    try {
      await FriendService.removeFriend(parseInt(effectiveUserId));
      setFriendStatus('none');
      setShowDropdown(false);
    } catch (err) {
      alert(err.message || '删除好友失败');
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleFollow = async () => {
    if (!isAuthenticated) { openAuth(); return; }
    try {
      await FollowService.toggleFollow(currentUser.id, parseInt(effectiveUserId));
      setIsFollowing(prev => !prev);
    } catch {}
  };

  // ─── 社交列表加载 ───
  const handleSocialClick = async (tab) => {
    if (socialTab === tab) { setSocialTab(null); return; }
    setSocialTab(tab);
    setSocialLoading(true);
    try {
      if (tab === 'following') {
        const data = await FollowService.getFollowing(effectiveUserId);
        setSocialList(Array.isArray(data) ? data : []);
      } else if (tab === 'followers') {
        const data = await FollowService.getFollowers(effectiveUserId);
        setSocialList(Array.isArray(data) ? data : []);
      } else if (tab === 'friends') {
        const data = await FriendService.getFriendList();
        setSocialList(Array.isArray(data) ? data : (data?.list || []));
      }
    } catch {
      setSocialList([]);
    } finally {
      setSocialLoading(false);
    }
  };

  // ─── 自己主页：编辑操作 ───
  const handleEdit = () => {
    setEditForm({
      name: userInfo.name,
      sign: userInfo.sign || '',
      bio: userInfo.bio || '',
      hobbies: userInfo.hobbies || '',
      contact: userInfo.contact || '',
    });
    setIsEditing(true);
  };

  const handleSave = () => {
    updateProfile(editForm);
    setUserInfo(prev => ({ ...prev, ...editForm }));
    setIsEditing(false);
  };

  const handleAvatarChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) return;
    if (file.size > 5 * 1024 * 1024) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setAvatarPreview(ev.target.result);
      updateProfile({ avatar: ev.target.result });
      setUserInfo(prev => ({ ...prev, avatar: ev.target.result }));
    };
    reader.readAsDataURL(file);
  };

  const handlePrivacyChange = (key, value) => {
    const updated = { ...privacySettings, [key]: value };
    setPrivacySettings(updated);
    // 同步更新后端字段：profile 对应 allow_profile_view，marks/info 对应 allow_comments_public
    const settings = {};
    if (key === 'profile') {
      settings.allow_profile_view = value === 'public' ? 1 : 0;
    }
    if (key === 'marks' || key === 'info') {
      settings.allow_comments_public = value === 'public' ? 1 : 0;
    }
    if (Object.keys(settings).length > 0 && currentUser?.id) {
      UserService.updateSettings(currentUser.id, settings).catch(() => {});
    }
    updateProfile({ preferences: { ...(currentUser?.preferences || {}), privacy: updated } });
  };

  // ─── 从 Bangumi 导入收藏 ───
  const handleImportFromBangumi = async () => {
    const bangumiToken = StorageService.get('acg_bangumi_token');
    const bangumiUser = StorageService.get('acg_bangumi_user');
    if (!bangumiToken || !bangumiUser) {
      alert('请先绑定 Bangumi 账号');
      return;
    }

    setBangumiImporting(true);
    setBangumiImportResult(null);

    try {
      const jwt = sessionStorage.getItem('acg_jwt_token');
      const proxyUrl = StorageService.get('acg_oauth_proxy_url') || import.meta.env.VITE_OAUTH_PROXY_URL || 'https://anispace-oauth-proxy.lyw2373314970.workers.dev';
      const res = await fetch(`${proxyUrl}/api/bangumi-sync/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          bangumiToken,
          bangumiUsername: bangumiUser.username || bangumiUser.nickname,
          overwrite: bangumiOverwrite,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setBangumiImportResult({ error: data.error });
      } else {
        setBangumiImportResult({ imported: data.imported, skipped: data.skipped, updated: data.updated || 0, total: data.total });
        // 刷新收藏列表
        if (currentUser?.id) {
          const marks = await CollectionMarkService.getByUserId(currentUser.id);
          setUserMarks(marks || []);
        }
      }
    } catch (err) {
      setBangumiImportResult({ error: err.message || '导入失败' });
    } finally {
      setBangumiImporting(false);
    }
  };

  // ─── 同步本地收藏到 Bangumi ───
  const handleUploadToBangumi = async () => {
    const bangumiToken = StorageService.get('acg_bangumi_token');
    const bangumiUser = StorageService.get('acg_bangumi_user');
    if (!bangumiToken || !bangumiUser) {
      alert('请先绑定 Bangumi 账号');
      return;
    }

    setBangumiUploading(true);
    setBangumiUploadResult(null);

    try {
      const jwt = sessionStorage.getItem('acg_jwt_token');
      const proxyUrl = StorageService.get('acg_oauth_proxy_url') || import.meta.env.VITE_OAUTH_PROXY_URL || 'https://anispace-oauth-proxy.lyw2373314970.workers.dev';
      const res = await fetch(`${proxyUrl}/api/bangumi-sync/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          bangumiToken,
          bangumiUsername: bangumiUser.username || bangumiUser.nickname,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setBangumiUploadResult({ error: data.error });
      } else {
        setBangumiUploadResult({ synced: data.synced, skipped: data.skipped, failed: data.failed, errors: data.errors });
      }
    } catch (err) {
      setBangumiUploadResult({ error: err.message || '同步失败' });
    } finally {
      setBangumiUploading(false);
    }
  };

  // ─── 数据设置持久化 ───
  useEffect(() => {
    StorageService.set('acg_data_settings', dataSettings);
    // 同步 auto_enrich 到后端
    if (currentUser?.id) {
      UserService.updateSettings(currentUser.id, { auto_enrich: dataSettings.auto_enrich ? 1 : 0 }).catch(() => {});
    }
  }, [dataSettings, currentUser?.id]);

  // ─── 导出 CSV ───
  const handleExportCSV = async () => {
    const userId = currentUser?.id;
    if (!userId) return;
    try {
      // 优先使用后端数据，本地备份作为补充
      let items = [];
      try {
        const marks = await CollectionMarkService.getByUserId(userId);
        items = Array.isArray(marks) ? marks : [];
      } catch {}
      // 如果后端无数据且有本地备份，使用本地备份
      if (items.length === 0 && dataSettings.local_backup) {
        items = CollectionMarkService.getLocalBackup();
      }
      if (items.length === 0) { alert('暂无收藏数据可导出'); return; }
      const header = '条目ID,条目名称,状态,评分,评论,标记时间';
      const rows = items.map(m => {
        const name = (m.subject_name || '').replace(/"/g, '""');
        const comment = (m.comment || '').replace(/"/g, '""');
        const markLabels = CollectionMarkService.getMarkLabels(m.subject_type);
        return `${m.subject_id},"${name}",${markLabels[m.status] || m.status},${m.rating ?? ''},"${comment}",${m.updated_at || m.saved_at || ''}`;
      });
      const csv = '\uFEFF' + [header, ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ANISpace_收藏数据_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('导出失败，请稍后重试');
    }
  };

  // ─── 判断是否可查看详情 ───
  const canViewProfile = isSelf || userInfo?.allow_profile_view;

  // ─── 加载中 ───
  if (loading) {
    return (
      <div className="user-profile-page">
        <div className="user-profile-loading">
          <div className="user-profile-skeleton-avatar" />
          <div className="user-profile-skeleton-lines">
            <div className="skeleton-line w60" />
            <div className="skeleton-line w40" />
            <div className="skeleton-line w80" />
          </div>
        </div>
      </div>
    );
  }

  // ─── 未登录提示 ───
  if (!isAuthenticated && isSelf) {
    return (
      <div className="user-profile-page">
        <div className="user-profile-not-found">
          <span>🔒</span>
          <h2>请先登录</h2>
          <button onClick={openAuth} className="back-link">去登录</button>
        </div>
      </div>
    );
  }

  // ─── 用户不存在 ───
  if (!userInfo) {
    return (
      <div className="user-profile-page">
        <div className="user-profile-not-found">
          <span>👤</span>
          <h2>用户不存在</h2>
          <Link to="/" className="back-link">返回首页</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="user-profile-page">
      <div className="user-profile-layout">
        {/* ═══ 左侧边栏 ═══ */}
        <aside className="user-profile-sidebar">
          <div className="user-profile-sidebar-header">
            {/* 头像 */}
            <div className="user-profile-avatar-wrap">
              <img src={avatarPreview || userInfo.avatar || FALLBACK_IMG} alt="" className="user-profile-avatar" loading="lazy" onError={e => { e.target.src = FALLBACK_IMG; }} />
              {isSelf && (
                <button className="avatar-upload-btn" onClick={() => avatarInputRef.current?.click()} title="更换头像">
                  <Camera size={12} />
                </button>
              )}
              <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png" onChange={handleAvatarChange} hidden />
            </div>

            <h2 className="user-profile-name">{userInfo.name}</h2>
            {userInfo.username && <p className="user-profile-username">@{userInfo.username}</p>}
            {userInfo.sign && <p className="user-profile-sign">{userInfo.sign}</p>}
            {userInfo.bio && (
              <div className="user-profile-bio-md">
                <MarkdownRenderer content={userInfo.bio} />
              </div>
            )}

            {/* ─── 操作按钮 ─── */}
            {isSelf ? (
              <div className="user-profile-actions">
                <button className="user-profile-action-btn edit" onClick={handleEdit}>
                  <Edit3 size={13} /> 编辑
                </button>
                <button className="user-profile-action-btn export" onClick={handleExportCSV}>
                  <Download size={13} /> 导出数据
                </button>
                {socialMode && (
                <Link to="/mailbox" className="user-profile-action-btn message">
                  <Mail size={13} /> D-Mail{unreadMail > 0 && <span className="mail-badge-small">{unreadMail}</span>}
                </Link>
                )}
                <button className="user-profile-action-btn settings" onClick={() => setShowSettings(true)}>
                  <Settings size={13} /> 设置
                </button>
              </div>
            ) : socialMode ? (
              <div className="user-profile-actions">
                {friendStatus === 'accepted' && (
                  <>
                    <span className="user-profile-badge friend">
                      <UserCheck size={13} /> 已好友
                    </span>
                    <Link to={`/mailbox?chat=${effectiveUserId}`} className="user-profile-action-btn message">
                      <MessageCircle size={13} /> 发私信
                    </Link>
                    <div className="user-profile-dropdown-wrap">
                      <button className="user-profile-action-btn more" onClick={() => setShowDropdown(!showDropdown)}>
                        <MoreHorizontal size={13} />
                      </button>
                      {showDropdown && (
                        <div className="user-profile-dropdown">
                          <button className="dropdown-item danger" onClick={handleRemoveFriend} disabled={actionLoading}>
                            <UserX size={13} /> 删除好友
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}
                {friendStatus === 'pending_sent' && (
                  <>
                    <button className="user-profile-action-btn disabled" disabled>
                      <UserPlus size={13} /> 已申请
                    </button>
                    <button className={`user-profile-action-btn follow ${isFollowing ? 'following' : ''}`} onClick={handleToggleFollow}>
                      {isFollowing ? '已关注' : '+ 关注'}
                    </button>
                  </>
                )}
                {friendStatus === 'pending_received' && (
                  <>
                    <button className="user-profile-action-btn accept" onClick={handleAcceptRequest} disabled={actionLoading}>
                      <UserCheck size={13} /> 通过申请
                    </button>
                    <button className="user-profile-action-btn reject" onClick={handleRejectRequest} disabled={actionLoading}>
                      <UserX size={13} /> 拒绝
                    </button>
                  </>
                )}
                {friendStatus === 'following' && (
                  <>
                    <button className={`user-profile-action-btn follow ${isFollowing ? 'following' : ''}`} onClick={handleToggleFollow}>
                      {isFollowing ? '已关注' : '+ 关注'}
                    </button>
                    <button className="user-profile-action-btn primary" onClick={() => setShowRequestModal(true)}>
                      <UserPlus size={13} /> 添加好友
                    </button>
                  </>
                )}
                {(friendStatus === 'none' || !friendStatus) && (
                  <>
                    <button className="user-profile-action-btn primary" onClick={() => setShowRequestModal(true)}>
                      <UserPlus size={13} /> 添加好友
                    </button>
                    <button className={`user-profile-action-btn follow ${isFollowing ? 'following' : ''}`} onClick={handleToggleFollow}>
                      {isFollowing ? '已关注' : '+ 关注'}
                    </button>
                  </>
                )}
              </div>
            ) : null}

            {/* ─── 个人信息 ─── */}
            <div className="user-profile-meta-list">
              {userInfo.joinDate && <div className="user-profile-meta-item"><Calendar size={14} /> <span>加入于 {userInfo.joinDate}</span></div>}
              {userInfo.provider && (
                <div className="user-profile-meta-item">
                  {userInfo.provider === 'bangumi' ? <BookOpen size={14} /> : userInfo.provider === 'github' ? <GitHubIcon size={14} /> : <Shield size={14} />}
                  <span>通过 {userInfo.provider === 'bangumi' ? 'Bangumi' : userInfo.provider === 'github' ? 'GitHub' : '系统'} 登录</span>
                </div>
              )}
              {userInfo.gender && userInfo.gender !== 'other' && (
                <div className="user-profile-meta-item"><MapPin size={14} /> <span>{userInfo.gender === 'male' ? '男' : '女'}</span></div>
              )}
              {userInfo.hobbies && (
                <div className="user-profile-meta-item"><Heart size={14} /> <span>{userInfo.hobbies}</span></div>
              )}
              {userInfo.contact && (
                <div className="user-profile-meta-item"><LinkIcon size={14} /> <span>{userInfo.contact}</span></div>
              )}
            </div>

            {/* ─── 社交统计 ─── */}
            {socialMode && (
            <div className="user-profile-social">
              <div className="user-profile-social-item"><span className="social-num">{userInfo.postCount || 0}</span><span className="social-label">帖子</span></div>
              <div className={`user-profile-social-item clickable ${socialTab === 'following' ? 'active' : ''}`} onClick={() => handleSocialClick('following')}><span className="social-num">{userInfo.followingCount || 0}</span><span className="social-label">关注</span></div>
              <div className={`user-profile-social-item clickable ${socialTab === 'followers' ? 'active' : ''}`} onClick={() => handleSocialClick('followers')}><span className="social-num">{userInfo.followerCount || 0}</span><span className="social-label">粉丝</span></div>
              <div className={`user-profile-social-item clickable ${socialTab === 'friends' ? 'active' : ''}`} onClick={() => handleSocialClick('friends')}><span className="social-num">{userInfo.friend_count || userInfo.friendCount || 0}</span><span className="social-label">好友</span></div>
            </div>
            )}
          </div>

          {/* ─── 数据统计 ─── */}
          {canViewProfile && (
            <div className="user-profile-sidebar-stats">
              <h3>数据统计</h3>
              <div className="sidebar-stat-row"><span>动画</span><span className="stat-val anime">{userMarks.filter(m => Number(m.subject_type) === 2).length}</span></div>
              <div className="sidebar-stat-row"><span>游戏</span><span className="stat-val game">{userMarks.filter(m => Number(m.subject_type) === 4).length}</span></div>
              <div className="sidebar-stat-row"><span>小说</span><span className="stat-val novel">{userMarks.filter(m => Number(m.subject_type) === 1).length}</span></div>
              <div className="sidebar-stat-row divider"><span>均分</span><span className="stat-val score">{avgScore}</span></div>
            </div>
          )}

          {/* ─── 标记进度条（仅自己主页） ─── */}
          {isSelf && canViewProfile && progressData.length > 0 && (
            <div className="user-profile-sidebar-progress">
              <h3>标记进度</h3>
              <div className="progress-bar-stack">
                {progressData.map(d => (
                  <div
                    key={d.key}
                    className="progress-bar-segment"
                    style={{ width: `${(d.count / totalMarks) * 100}%`, background: d.color }}
                    title={`${d.label}: ${d.count}`}
                  />
                ))}
              </div>
              <div className="progress-legend">
                {progressData.map(d => (
                  <div key={d.key} className="progress-legend-item">
                    <span className="progress-legend-left">
                      <span className="progress-legend-dot" style={{ background: d.color }} />
                      {d.label}
                    </span>
                    <span className="progress-legend-count">{d.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─── 活跃度热力图（侧边栏，仅自己主页） ─── */}
          {isSelf && canViewProfile && (
            <div className="user-profile-sidebar-heatmap">
              <h3>活跃度</h3>
              <ActivityHeatmap data={activityData} />
            </div>
          )}
        </aside>

        {/* ═══ 右侧主内容 ═══ */}
        <main className="user-profile-main">
          {!canViewProfile ? (
            <div className="user-profile-private-hint">
              <Shield size={32} />
              <h3>该用户的主页仅对好友可见</h3>
              <p>添加好友后即可查看 TA 的收藏和评分</p>
            </div>
          ) : (
            <>
              {/* ─── 社交列表（点击关注/粉丝/好友后显示） ─── */}
              {socialTab && (
                <div className="user-profile-social-panel">
                  <div className="social-panel-header">
                    <h3>{socialTab === 'following' ? '关注列表' : socialTab === 'followers' ? '粉丝列表' : '好友列表'}</h3>
                    <button className="social-panel-close" onClick={() => setSocialTab(null)}>✕</button>
                  </div>
                  {socialLoading ? (
                    <div className="social-panel-loading"><Loader2 size={20} className="spin" /></div>
                  ) : socialList.length > 0 ? (
                    <div className="social-panel-list">
                      {socialList.map(user => (
                        <Link key={user.id || user.userId} to={`/user/${user.id || user.userId}`} className="social-panel-item">
                          <img src={user.avatar || FALLBACK_IMG} alt="" className="social-panel-avatar" loading="lazy" onError={e => { e.target.src = FALLBACK_IMG; }} />
                          <div className="social-panel-info">
                            <span className="social-panel-name">{user.name || user.username || '用户'}</span>
                            {user.sign && <span className="social-panel-sign">{user.sign}</span>}
                          </div>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div className="social-panel-empty">
                      <Users size={32} />
                      <p>{socialTab === 'following' ? '暂无关注' : socialTab === 'followers' ? '暂无粉丝' : '暂无好友'}</p>
                    </div>
                  )}
                </div>
              )}

              {/* ─── 标签页切换 ─── */}
              <div className="user-profile-tabs">
                <button className={`user-profile-tab ${activeTab === 'collections' ? 'active' : ''}`} onClick={() => setActiveTab('collections')}>
                  <BookOpen size={14} /> 收藏
                </button>
                {socialMode && isSelf && (
                  <button className={`user-profile-tab ${activeTab === 'friends' ? 'active' : ''}`} onClick={() => setActiveTab('friends')}>
                    <Users size={14} /> 好友
                    {receivedRequests.length > 0 && <span className="user-profile-tab-badge">{receivedRequests.length}</span>}
                  </button>
                )}
                <button className={`user-profile-tab ${activeTab === 'guestbook' ? 'active' : ''}`} onClick={() => setActiveTab('guestbook')}>
                  <MessageSquare size={14} /> 留言
                </button>
                <button className={`user-profile-tab ${activeTab === 'comments' ? 'active' : ''}`} onClick={() => setActiveTab('comments')}>
                  <MessageCircle size={14} /> 评论
                </button>
                <button className={`user-profile-tab ${activeTab === 'news' ? 'active' : ''}`} onClick={() => setActiveTab('news')}>
                  <Newspaper size={14} /> 资讯
                </button>
                {socialMode && (
                <button className={`user-profile-tab ${activeTab === 'posts' ? 'active' : ''}`} onClick={() => setActiveTab('posts')}>
                  <BookOpen size={14} /> 发帖
                </button>
                )}
                {isSelf && (
                <button className={`user-profile-tab ${activeTab === 'creative' ? 'active' : ''}`} onClick={() => setActiveTab('creative')}>
                  <Feather size={14} /> 创作
                </button>
                )}
              </div>

              {/* ─── 收藏标签页 ─── */}
              {activeTab === 'collections' && (
                <>
                  {/* 活跃度热力图（他人主页在主内容区显示） */}
                  {!isSelf && (
                    <div className="user-profile-category-section">
                      <div className="user-profile-category-header">
                        <Activity size={16} style={{ color: 'var(--primary)' }} />
                        <span className="category-title">活跃度</span>
                      </div>
                      {activityLoading ? (
                        <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-quaternary)' }}>
                          <Loader2 size={20} className="spin" />
                        </div>
                      ) : activityData.length > 0 ? (
                        <ActivityHeatmap data={activityData} />
                      ) : (
                        <div className="category-empty">暂无活跃度数据</div>
                      )}
                    </div>
                  )}

                  {/* 收藏分类列表 */}
                  {['wish', 'doing', 'collect', 'on_hold', 'dropped'].map(status => {
                    const allItems = userMarks.filter(m => m.status === status);
                    const filterType = categoryFilter[status];
                    const items = filterType
                      ? allItems.filter(m => {
                          const t = Number(m.subject_type);
                          // 三次元(6)归入动画(2)
                          return filterType === 2 ? (t === 2 || t === 6) : t === filterType;
                        })
                      : allItems;
                    const isCollapsed = (status === 'on_hold' || status === 'dropped') && expandedCategory !== status && items.length > 0;
                    const verbs = STATUS_VERBS[status];

                    return (
                      <div key={status} className="user-profile-category-section">
                        <div className="user-profile-category-header">
                          <span className="category-indicator" style={{ background: MARK_COLORS[status] }} />
                          {verbs ? (
                            <span className="category-filter-tags">
                              {verbs.map(({ verb, type }) => (
                                <span
                                  key={type}
                                  className={`category-filter-tag ${categoryFilter[status] === type ? 'active' : ''}`}
                                  onClick={() => toggleCategoryFilter(status, type)}
                                >
                                  {verb}
                                </span>
                              ))}
                            </span>
                          ) : (
                            <span className="category-title">{CollectionMarkService.MARK_LABELS[status]}</span>
                          )}
                          <span className="category-count">{items.length} 部</span>
                          {(status === 'on_hold' || status === 'dropped') ? (
                            isCollapsed && (
                              <span className="category-more" onClick={() => setExpandedCategory(status)}>展开 ▼</span>
                            )
                          ) : (
                            items.length > 5 && expandedCategory !== status && (
                              <span className="category-more" onClick={() => setExpandedCategory(status)}>更多 →</span>
                            )
                          )}
                          {expandedCategory === status && (
                            <span className="category-more" onClick={() => setExpandedCategory(null)}>收起 ↑</span>
                          )}
                        </div>
                        {!isCollapsed && (
                          items.length > 0 ? (
                            <div className="category-covers">
                              {(expandedCategory === status ? items : items.slice(0, 5)).map(mark => (
                                <SubjectCard
                                  key={`${mark.user_id}_${mark.subject_id}`}
                                  item={{
                                    id: mark.subject_id,
                                    name: mark.subject_name || `条目 #${mark.subject_id}`,
                                    name_cn: mark.subject_name || '',
                                    image: mark.subject_image || '',
                                    images: mark.subject_image ? { large: mark.subject_image, common: mark.subject_image } : {},
                                    rating: { score: 0 },
                                    tags: [],
                                  }}
                                  type={Number(mark.subject_type) === 1 ? 'novel' : Number(mark.subject_type) === 4 ? 'game' : 'anime'}
                                  linkTo={`/info/${Number(mark.subject_type) === 1 ? 'novel' : Number(mark.subject_type) === 4 ? 'game' : 'anime'}/${mark.subject_id}`}
                                  linkState={{ preview: extractPreview({ id: mark.subject_id, name: mark.subject_name, name_cn: mark.subject_name, type: Number(mark.subject_type), images: mark.subject_image ? { large: mark.subject_image, common: mark.subject_image } : {} }) }}
                                />
                              ))}
                            </div>
                          ) : (
                            <div className="category-empty">暂无{status === 'wish' ? '想看/想读/想玩' : status === 'collect' ? '看过/读过/玩过' : status === 'doing' ? '在看/在读/在玩' : CollectionMarkService.MARK_LABELS[status]}</div>
                          )
                        )}
                      </div>
                    );
                  })}

                  {/* 评论列表 */}
                  <div className="user-profile-category-section">
                    <div className="user-profile-category-header">
                      <MessageSquare size={16} style={{ color: 'var(--primary)' }} />
                      <span className="category-title">评论</span>
                      <span className="category-count">{userComments.length} 条</span>
                      {userComments.length > 5 && !expandedSections.comments && (
                        <span className="category-more" onClick={() => setExpandedSections(prev => ({ ...prev, comments: true }))}>更多 →</span>
                      )}
                      {expandedSections.comments && (
                        <span className="category-more" onClick={() => setExpandedSections(prev => ({ ...prev, comments: false }))}>收起 ↑</span>
                      )}
                    </div>
                    {commentsLoading ? (
                      <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-quaternary)' }}>
                        <Loader2 size={20} className="spin" />
                      </div>
                    ) : userComments.length > 0 ? (
                      <div className="user-profile-comments">
                        {(expandedSections.comments ? userComments : userComments.slice(0, 5)).map(comment => (
                          <div key={comment.id} className="user-profile-comment-item">
                            <div className="comment-item-header">
                              {comment.subject_name && (
                                <Link
                                  to={`/info/${Number(comment.subject_type) === 1 ? 'novel' : Number(comment.subject_type) === 4 ? 'game' : 'anime'}/${comment.subject_id}`}
                                  state={{ preview: extractPreview({ id: comment.subject_id, name: comment.subject_name, name_cn: comment.subject_name, type: Number(comment.subject_type), images: comment.subject_image ? { large: comment.subject_image, common: comment.subject_image } : {} }) }}
                                  className="comment-subject-link"
                                >
                                  {comment.subject_name}
                                </Link>
                              )}
                              {comment.score > 0 && (
                                <span className="comment-score">
                                  <Star size={10} fill="var(--accent-warm)" style={{ color: 'var(--accent-warm)' }} /> {comment.score}
                                </span>
                              )}
                            </div>
                            {comment.content && (
                              <p className="comment-item-content">{comment.content.length > 120 ? comment.content.substring(0, 120) + '...' : comment.content}</p>
                            )}
                            <span className="comment-item-time">{new Date(comment.created_at).toLocaleDateString('zh-CN')}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="category-empty">暂无评论</div>
                    )}
                  </div>
                </>
              )}

              {/* ─── 好友标签页（仅自己主页） ─── */}
              {isSelf && activeTab === 'friends' && (
                <div className="user-profile-friends-tab">
                  {/* 搜索用户 */}
                  <div className="user-profile-friend-search">
                    <div className="user-profile-friend-search-input-wrap">
                      <Search size={16} className="user-profile-friend-search-icon" />
                      <input
                        type="text"
                        placeholder="搜索用户..."
                        value={searchKeyword}
                        onChange={e => setSearchKeyword(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && searchKeyword.trim()) {
                            setSearchLoading(true);
                            FriendService.searchUsers(searchKeyword.trim()).then(data => {
                              setSearchResults(Array.isArray(data) ? data : []);
                            }).catch(() => {
                              setSearchResults([]);
                            }).finally(() => setSearchLoading(false));
                          }
                        }}
                        className="user-profile-friend-search-input"
                      />
                      {searchLoading && <Loader2 size={14} className="user-profile-friend-search-spinner" />}
                    </div>
                  </div>

                  {/* 搜索结果 */}
                  {searchResults.length > 0 && (
                    <div className="user-profile-friend-section">
                      <h3 className="user-profile-friend-section-title">搜索结果</h3>
                      <div className="user-profile-friend-list">
                        {searchResults.map(user => (
                          <Link key={user.id} to={`/user/${user.id}`} className="user-profile-friend-item">
                            <img src={user.avatar || FALLBACK_IMG} alt="" className="user-profile-friend-avatar" loading="lazy" onError={e => { e.target.src = FALLBACK_IMG; }} />
                            <div className="user-profile-friend-info">
                              <span className="user-profile-friend-name">{user.name}</span>
                              {user.sign && <span className="user-profile-friend-sign">{user.sign}</span>}
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 收到的好友请求 */}
                  {receivedRequests.length > 0 && (
                    <div className="user-profile-friend-section">
                      <h3 className="user-profile-friend-section-title">
                        好友请求 <span className="user-profile-friend-count">{receivedRequests.length}</span>
                      </h3>
                      <div className="user-profile-friend-list">
                        {receivedRequests.map(req => (
                          <div key={req.id} className="user-profile-friend-item with-actions">
                            <Link to={`/user/${req.from_user_id || req.userId}`} className="user-profile-friend-item-left">
                              <img src={req.from_user_avatar || req.avatar || FALLBACK_IMG} alt="" className="user-profile-friend-avatar" loading="lazy" onError={e => { e.target.src = FALLBACK_IMG; }} />
                              <div className="user-profile-friend-info">
                                <span className="user-profile-friend-name">{req.from_user_name || req.name || '用户'}</span>
                                {req.message && <span className="user-profile-friend-sign">{req.message}</span>}
                              </div>
                            </Link>
                            <div className="user-profile-friend-request-actions">
                              <button className="user-profile-friend-accept-btn" onClick={async () => {
                                try {
                                  await FriendService.handleFriendRequest(req.id, 'accepted');
                                  setReceivedRequests(prev => prev.filter(r => r.id !== req.id));
                                  const friends = await FriendService.getFriendList();
                                  setFriendList(Array.isArray(friends) ? friends : (friends?.list || []));
                                } catch (err) {
                                  alert(err.message || '操作失败');
                                }
                              }}>
                                <UserCheck size={12} /> 通过
                              </button>
                              <button className="user-profile-friend-reject-btn" onClick={async () => {
                                try {
                                  await FriendService.handleFriendRequest(req.id, 'rejected');
                                  setReceivedRequests(prev => prev.filter(r => r.id !== req.id));
                                } catch (err) {
                                  alert(err.message || '操作失败');
                                }
                              }}>
                                <UserX size={12} /> 拒绝
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 发出的好友请求 */}
                  {sentRequests.length > 0 && (
                    <div className="user-profile-friend-section">
                      <h3 className="user-profile-friend-section-title">待通过请求</h3>
                      <div className="user-profile-friend-list">
                        {sentRequests.map(req => (
                          <Link key={req.id} to={`/user/${req.to_user_id || req.userId}`} className="user-profile-friend-item">
                            <img src={req.to_user_avatar || req.avatar || FALLBACK_IMG} alt="" className="user-profile-friend-avatar" loading="lazy" onError={e => { e.target.src = FALLBACK_IMG; }} />
                            <div className="user-profile-friend-info">
                              <span className="user-profile-friend-name">{req.to_user_name || req.name || '用户'}</span>
                              <span className="user-profile-friend-sign pending">等待通过</span>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 好友列表 */}
                  <div className="user-profile-friend-section">
                    <h3 className="user-profile-friend-section-title">
                      好友列表 <span className="user-profile-friend-count">{friendList.length}</span>
                    </h3>
                    {friendList.length > 0 ? (
                      <div className="user-profile-friend-list">
                        {friendList.map(friend => (
                          <Link key={friend.id || friend.userId} to={`/user/${friend.id || friend.userId}`} className="user-profile-friend-item">
                            <img src={friend.avatar || FALLBACK_IMG} alt="" className="user-profile-friend-avatar" loading="lazy" onError={e => { e.target.src = FALLBACK_IMG; }} />
                            <div className="user-profile-friend-info">
                              <span className="user-profile-friend-name">{friend.name || friend.username || '用户'}</span>
                              {friend.sign && <span className="user-profile-friend-sign">{friend.sign}</span>}
                            </div>
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <div className="user-profile-friend-empty">
                        <Users size={32} />
                        <p>暂无好友</p>
                        <span>搜索并添加好友吧~</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ─── 留言板标签页 ─── */}
              {activeTab === 'guestbook' && (
                <div className="user-profile-guestbook-tab">
                  {/* 留言板关闭提示 */}
                  {!userInfo?.allow_guestbook && !isSelf && (
                    <div className="category-empty">
                      <Lock size={32} />
                      <p>该用户已关闭留言板</p>
                    </div>
                  )}
                  {(userInfo?.allow_guestbook || isSelf) && (
                    <>
                      {/* 留言板开关（仅自己主页） */}
                      {isSelf && (
                        <div className="guestbook-toggle">
                          <span>留言板</span>
                          <button
                            className={`guestbook-toggle-btn ${userInfo?.allow_guestbook ? 'on' : 'off'}`}
                            onClick={async () => {
                              const newVal = userInfo?.allow_guestbook ? 0 : 1;
                              try {
                                await UserGuestbookService.updateGuestbookSettings(currentUser.id, newVal);
                                setUserInfo(prev => ({ ...prev, allow_guestbook: newVal }));
                              } catch {}
                            }}
                          >
                            {userInfo?.allow_guestbook ? '已开启' : '已关闭'}
                          </button>
                        </div>
                      )}

                      {/* 留言输入框（需登录且留言板开启） */}
                      {isAuthenticated && userInfo?.allow_guestbook && (
                        <div className="guestbook-input-wrap">
                          <textarea
                            className="guestbook-input"
                            placeholder="写一句留言吧~"
                            value={guestbookInput}
                            onChange={e => setGuestbookInput(e.target.value)}
                            rows={2}
                          />
                          <button
                            className="guestbook-send-btn"
                            disabled={!guestbookInput.trim() || guestbookSubmitting}
                            onClick={async () => {
                              if (!guestbookInput.trim()) return;
                              setGuestbookSubmitting(true);
                              try {
                                const newMsg = await UserGuestbookService.postMessage(
                                  parseInt(effectiveUserId),
                                  guestbookInput.trim()
                                );
                                setGuestbookMessages(prev => [newMsg, ...prev]);
                                setGuestbookInput('');
                              } catch (err) {
                                alert(err.message || '留言失败');
                              } finally {
                                setGuestbookSubmitting(false);
                              }
                            }}
                          >
                            {guestbookSubmitting ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
                          </button>
                        </div>
                      )}

                      {/* 留言列表 */}
                      {guestbookLoading ? (
                        <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-quaternary)' }}>
                          <Loader2 size={20} className="spin" />
                        </div>
                      ) : guestbookMessages.length > 0 ? (
                        <div className="guestbook-list">
                          {(expandedSections.guestbook ? guestbookMessages : guestbookMessages.slice(0, 5)).map(msg => (
                            <div key={msg.id} className="guestbook-item">
                              <div className="guestbook-item-header">
                                <Link to={`/user/${msg.author_id}`} className="guestbook-author">
                                  <img src={msg.author_avatar || FALLBACK_IMG} alt="" className="guestbook-author-avatar" loading="lazy" onError={e => { e.target.src = FALLBACK_IMG; }} />
                                  <span className="guestbook-author-name">{msg.author_name || '用户'}</span>
                                </Link>
                                <span className="guestbook-time">{new Date(msg.created_at).toLocaleDateString('zh-CN')}</span>
                                {/* 删除按钮：留言板主人或留言作者 */}
                                {isAuthenticated && (currentUser?.id === msg.author_id || currentUser?.id === parseInt(effectiveUserId)) && (
                                  <button className="guestbook-delete-btn" onClick={async () => {
                                    if (!confirm('确定删除这条留言？')) return;
                                    try {
                                      await UserGuestbookService.deleteMessage(parseInt(effectiveUserId), msg.id);
                                      setGuestbookMessages(prev => prev.filter(m => m.id !== msg.id));
                                    } catch {}
                                  }}>
                                    <Trash2 size={12} />
                                  </button>
                                )}
                              </div>
                              <p className="guestbook-content">{msg.content}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="category-empty">暂无留言</div>
                      )}
                      {guestbookMessages.length > 5 && !expandedSections.guestbook && (
                        <span className="category-more" style={{ marginTop: 8 }} onClick={() => setExpandedSections(prev => ({ ...prev, guestbook: true }))}>更多 →</span>
                      )}
                      {expandedSections.guestbook && guestbookMessages.length > 5 && (
                        <span className="category-more" style={{ marginTop: 8 }} onClick={() => setExpandedSections(prev => ({ ...prev, guestbook: false }))}>收起 ↑</span>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ─── 评论标签页 ─── */}
              {activeTab === 'comments' && (
                <div className="user-profile-comments-tab">
                  {commentsLoading ? (
                    <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-quaternary)' }}>
                      <Loader2 size={20} className="spin" />
                    </div>
                  ) : userComments.length > 0 ? (
                    <div className="user-profile-comments">
                      {(expandedSections.commentsTab ? userComments : userComments.slice(0, 5)).map(comment => (
                        <div key={comment.id} className="user-profile-comment-item">
                          <div className="comment-item-header">
                            {comment.subject_name && (
                              <Link
                                to={`/info/${Number(comment.subject_type) === 1 ? 'novel' : Number(comment.subject_type) === 4 ? 'game' : 'anime'}/${comment.subject_id}`}
                                state={{ preview: extractPreview({ id: comment.subject_id, name: comment.subject_name, name_cn: comment.subject_name, type: Number(comment.subject_type), images: comment.subject_image ? { large: comment.subject_image, common: comment.subject_image } : {} }) }}
                                className="comment-subject-link"
                              >
                                {comment.subject_name}
                              </Link>
                            )}
                            {comment.score > 0 && (
                              <span className="comment-score">
                                <Star size={10} fill="var(--accent-warm)" style={{ color: 'var(--accent-warm)' }} /> {comment.score}
                              </span>
                            )}
                          </div>
                          {comment.content && (
                            <p className="comment-item-content">{comment.content.length > 200 ? comment.content.substring(0, 200) + '...' : comment.content}</p>
                          )}
                          <span className="comment-item-time">{new Date(comment.created_at).toLocaleDateString('zh-CN')}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="category-empty">暂无评论</div>
                  )}
                  {userComments.length > 5 && !expandedSections.commentsTab && (
                    <span className="category-more" style={{ marginTop: 8 }} onClick={() => setExpandedSections(prev => ({ ...prev, commentsTab: true }))}>更多 →</span>
                  )}
                  {expandedSections.commentsTab && userComments.length > 5 && (
                    <span className="category-more" style={{ marginTop: 8 }} onClick={() => setExpandedSections(prev => ({ ...prev, commentsTab: false }))}>收起 ↑</span>
                  )}
                </div>
              )}

              {/* ─── 资讯标签页 ─── */}
              {activeTab === 'news' && (
                <div className="user-profile-news-tab">
                  {/* 资讯显示开关（仅自己主页） */}
                  {isSelf && (
                    <div className="guestbook-toggle">
                      <span>在主页显示资讯</span>
                      <button
                        className={`guestbook-toggle-btn ${userInfo?.show_news ? 'on' : 'off'}`}
                        onClick={async () => {
                          const newVal = userInfo?.show_news ? 0 : 1;
                          try {
                            await UserGuestbookService.updateProfileVisibility(currentUser.id, { show_news: newVal });
                            setUserInfo(prev => ({ ...prev, show_news: newVal }));
                          } catch {}
                        }}
                      >
                        {userInfo?.show_news ? '已开启' : '已关闭'}
                      </button>
                    </div>
                  )}
                  {!isSelf && !userInfo?.show_news ? (
                    <div className="category-empty">
                      <Lock size={32} />
                      <p>该用户已隐藏资讯</p>
                    </div>
                  ) : newsLoading ? (
                    <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-quaternary)' }}>
                      <Loader2 size={20} className="spin" />
                    </div>
                  ) : userNews.length > 0 ? (
                    <div className="user-profile-news-list">
                      {(expandedSections.news ? userNews : userNews.slice(0, 5)).map(item => (
                        <Link key={item.id} to={`/news/${item.id}`} className="user-profile-news-item">
                          <div className="news-item-info">
                            <span className="news-item-title">{item.title}</span>
                            <span className="news-item-meta">{item.source || '原创'} · {new Date(item.created_at).toLocaleDateString('zh-CN')}</span>
                          </div>
                          {item.cover && <img src={item.cover} alt="" className="news-item-cover" loading="lazy" onError={e => { e.target.style.display = 'none'; }} />}
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div className="category-empty">暂无资讯</div>
                  )}
                  {userNews.length > 5 && !expandedSections.news && (
                    <span className="category-more" style={{ marginTop: 8 }} onClick={() => setExpandedSections(prev => ({ ...prev, news: true }))}>更多 →</span>
                  )}
                  {expandedSections.news && userNews.length > 5 && (
                    <span className="category-more" style={{ marginTop: 8 }} onClick={() => setExpandedSections(prev => ({ ...prev, news: false }))}>收起 ↑</span>
                  )}
                </div>
              )}

              {/* ─── 发帖标签页 ─── */}
              {activeTab === 'posts' && (
                <div className="user-profile-posts-tab">
                  {/* 发帖显示开关（仅自己主页） */}
                  {isSelf && (
                    <div className="guestbook-toggle">
                      <span>在主页显示发帖</span>
                      <button
                        className={`guestbook-toggle-btn ${userInfo?.show_posts ? 'on' : 'off'}`}
                        onClick={async () => {
                          const newVal = userInfo?.show_posts ? 0 : 1;
                          try {
                            await UserGuestbookService.updateProfileVisibility(currentUser.id, { show_posts: newVal });
                            setUserInfo(prev => ({ ...prev, show_posts: newVal }));
                          } catch {}
                        }}
                      >
                        {userInfo?.show_posts ? '已开启' : '已关闭'}
                      </button>
                    </div>
                  )}
                  {!isSelf && !userInfo?.show_posts ? (
                    <div className="category-empty">
                      <Lock size={32} />
                      <p>该用户已隐藏发帖</p>
                    </div>
                  ) : postsLoading ? (
                    <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-quaternary)' }}>
                      <Loader2 size={20} className="spin" />
                    </div>
                  ) : userPosts.length > 0 ? (
                    <div className="user-profile-posts-list">
                      {(expandedSections.posts ? userPosts : userPosts.slice(0, 5)).map(post => (
                        <Link key={post.id} to={`/forum/${post.id}`} className="user-profile-post-item">
                          <div className="post-item-info">
                            <span className="post-item-title">{post.title}</span>
                            <span className="post-item-meta">{post.category || '综合'} · {new Date(post.created_at).toLocaleDateString('zh-CN')} · {post.views || 0} 浏览</span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div className="category-empty">暂无发帖</div>
                  )}
                  {userPosts.length > 5 && !expandedSections.posts && (
                    <span className="category-more" style={{ marginTop: 8 }} onClick={() => setExpandedSections(prev => ({ ...prev, posts: true }))}>更多 →</span>
                  )}
                  {expandedSections.posts && userPosts.length > 5 && (
                    <span className="category-more" style={{ marginTop: 8 }} onClick={() => setExpandedSections(prev => ({ ...prev, posts: false }))}>收起 ↑</span>
                  )}
                </div>
              )}

              {/* ─── 创作空间标签页 ─── */}
              {activeTab === 'creative' && isSelf && (
                <div className="user-profile-category-section">
                  <CreativeSpace userId={effectiveUserId} isSelf={isSelf} />
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* ═══ 编辑资料弹窗 ═══ */}
      {isEditing && (
        <div className="user-profile-overlay" onClick={() => setIsEditing(false)}>
          <div className="user-profile-edit-modal animate-scale-in" onClick={e => e.stopPropagation()}>
            <h2>编辑资料</h2>
            <div className="edit-field">
              <label>昵称</label>
              <input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            <div className="edit-field">
              <label>个性签名</label>
              <input value={editForm.sign} onChange={e => setEditForm({ ...editForm, sign: e.target.value })} placeholder="写点什么吧~" />
            </div>
            <div className="edit-field">
              <label>个人简介</label>
              <textarea rows={3} value={editForm.bio} onChange={e => setEditForm({ ...editForm, bio: e.target.value })} placeholder="介绍一下自己..." />
            </div>
            <div className="edit-field">
              <label>兴趣爱好</label>
              <input value={editForm.hobbies} onChange={e => setEditForm({ ...editForm, hobbies: e.target.value })} placeholder="动画、游戏、音乐..." />
            </div>
            <div className="edit-field">
              <label>联系方式</label>
              <input value={editForm.contact} onChange={e => setEditForm({ ...editForm, contact: e.target.value })} placeholder="网站、社交账号..." />
            </div>
            <div className="edit-actions">
              <button className="edit-cancel" onClick={() => setIsEditing(false)}>取消</button>
              <button className="edit-save" onClick={handleSave}>保存</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ 好友请求弹窗 ═══ */}
      {showRequestModal && (
        <div className="user-profile-overlay" onClick={() => setShowRequestModal(false)}>
          <div className="user-profile-request-modal animate-scale-in" onClick={e => e.stopPropagation()}>
            <h2>添加好友</h2>
            <p className="request-modal-desc">向 <strong>{userInfo.name}</strong> 发送好友请求</p>
            <div className="request-modal-field">
              <label>验证消息（可选）</label>
              <textarea
                rows={3}
                placeholder="你好，我是..."
                value={requestMessage}
                onChange={e => setRequestMessage(e.target.value)}
              />
            </div>
            <div className="request-modal-actions">
              <button className="request-cancel" onClick={() => setShowRequestModal(false)}>取消</button>
              <button className="request-send" onClick={handleSendRequest} disabled={actionLoading}>
                {actionLoading ? '发送中...' : '发送请求'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ 设置弹窗 ═══ */}
      {showSettings && isSelf && (
        <div className="user-profile-overlay" onClick={() => setShowSettings(false)}>
          <div className="settings-modal animate-scale-in" onClick={e => e.stopPropagation()}>
            <div className="settings-sidebar">
              <h2>设置</h2>
              <button className={`settings-nav ${settingsTab === 'profile' ? 'active' : ''}`} onClick={() => setSettingsTab('profile')}>
                <Edit3 size={14} /> 个人资料
              </button>
              <button className={`settings-nav ${settingsTab === 'privacy' ? 'active' : ''}`} onClick={() => setSettingsTab('privacy')}>
                <Shield size={14} /> 隐私设置
              </button>
              <button className={`settings-nav ${settingsTab === 'bangumi' ? 'active' : ''}`} onClick={() => setSettingsTab('bangumi')}>
                <BookOpen size={14} /> 账号绑定
              </button>
              <button className={`settings-nav ${settingsTab === 'theme' ? 'active' : ''}`} onClick={() => setSettingsTab('theme')}>
                <Smile size={14} /> 主题外观
              </button>
              <button className={`settings-nav ${settingsTab === 'data' ? 'active' : ''}`} onClick={() => setSettingsTab('data')}>
                <Database size={14} /> 数据
              </button>
              <button className={`settings-nav ${settingsTab === 'content' ? 'active' : ''}`} onClick={() => setSettingsTab('content')}>
                <ShieldOff size={14} /> 内容过滤
              </button>
            </div>
            <div className="settings-content">
              {settingsTab === 'profile' && (
                <div className="settings-section">
                  <h3>个人资料</h3>
                  <div className="settings-item">
                    <label>头像</label>
                    <div className="avatar-settings">
                      <img src={avatarPreview || userInfo.avatar} alt="" className="settings-avatar" loading="lazy" onError={e => { e.target.src = FALLBACK_IMG; }} />
                      <button className="settings-btn" onClick={() => avatarInputRef.current?.click()}>更换头像</button>
                      <p className="settings-hint">支持 JPG、PNG 格式，5MB 以内</p>
                    </div>
                  </div>
                  <div className="settings-item">
                    <label>个性签名</label>
                    <input className="settings-input" value={userInfo.sign || ''} onChange={e => { updateProfile({ sign: e.target.value }); setUserInfo(prev => ({ ...prev, sign: e.target.value })); }} placeholder="写点什么吧~" />
                  </div>
                </div>
              )}
              {settingsTab === 'privacy' && (
                <div className="settings-section">
                  <h3>隐私设置</h3>
                  {[
                    { key: 'profile', label: '主页访问权限' },
                    { key: 'marks', label: '标记可见范围' },
                    { key: 'info', label: '个人信息可见范围' },
                  ].map(item => (
                    <div key={item.key} className="privacy-item">
                      <label>{item.label}</label>
                      <div className="privacy-options">
                        {PRIVACY_OPTIONS.map(opt => (
                          <button key={opt.key} className={`privacy-btn ${privacySettings[item.key] === opt.key ? 'active' : ''}`} onClick={() => handlePrivacyChange(item.key, opt.key)}>
                            <opt.icon size={12} /> {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {settingsTab === 'bangumi' && (
                <div className="settings-section">
                  <h3>账号绑定</h3>
                  <p className="settings-desc">绑定第三方账号可同步数据或快速登录</p>
                  <div className="account-bind-section">
                    <h4>Bangumi</h4>
                    {BangumiAuthService.isBound() ? (
                      <div className="bangumi-bound-info">
                        <div className="bangumi-bound-user">
                          <img src={BangumiAuthService.getBoundAccount()?.avatar || FALLBACK_IMG} alt="" className="settings-avatar" loading="lazy" onError={e => { e.target.src = FALLBACK_IMG; }} />
                          <div>
                            <span className="bangumi-bound-name">{BangumiAuthService.getBoundAccount()?.nickname || BangumiAuthService.getBoundAccount()?.name || '已绑定'}</span>
                            <span className="settings-hint">Bangumi 账号已绑定</span>
                          </div>
                        </div>
                        <button className="bangumi-unbind-btn" onClick={async () => { await BangumiAuthService.unbindFromServer(); setSettingsTab('bangumi'); }}>解除绑定</button>
                      </div>
                    ) : (
                      <>
                        <button className="bangumi-bind-btn" onClick={() => BangumiAuthService.initiateLogin(true)}>
                          <BookOpen size={16} /> 绑定 Bangumi 账号
                        </button>
                        <p className="settings-hint">将跳转至 Bangumi 进行授权</p>
                      </>
                    )}
                    {/* Bangumi 导入功能 */}
                    {BangumiAuthService.isBound() && (
                      <div className="bangumi-import-section" style={{ marginTop: '12px' }}>
                        <label className="bangumi-overwrite-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', fontSize: '13px', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={bangumiOverwrite}
                            onChange={e => setBangumiOverwrite(e.target.checked)}
                            style={{ cursor: 'pointer' }}
                          />
                          覆盖已有记录（用 Bangumi 数据替换本地名称/封面/状态）
                        </label>
                        <button
                          className="bangumi-bind-btn"
                          onClick={handleImportFromBangumi}
                          disabled={bangumiImporting}
                          style={{ opacity: bangumiImporting ? 0.6 : 1 }}
                        >
                          {bangumiImporting ? <Loader2 size={16} className="oauth-spinning" /> : <Download size={16} />}
                          {bangumiImporting ? '正在导入...' : '从 Bangumi 导入收藏'}
                        </button>
                        {bangumiImportResult && (
                          <div className="bangumi-import-result" style={{ marginTop: '8px', fontSize: '13px' }}>
                            {bangumiImportResult.error ? (
                              <span style={{ color: 'var(--error)' }}>导入失败: {bangumiImportResult.error}</span>
                            ) : (
                              <span style={{ color: 'var(--success)' }}>
                                导入完成: 新增 {bangumiImportResult.imported} 条，更新 {bangumiImportResult.updated || 0} 条，跳过 {bangumiImportResult.skipped} 条，共 {bangumiImportResult.total} 条
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {/* 同步到 Bangumi 功能 */}
                    {BangumiAuthService.isBound() && (
                      <div className="bangumi-upload-section" style={{ marginTop: '12px' }}>
                        <button
                          className="bangumi-bind-btn"
                          onClick={handleUploadToBangumi}
                          disabled={bangumiUploading}
                          style={{ opacity: bangumiUploading ? 0.6 : 1 }}
                        >
                          {bangumiUploading ? <Loader2 size={16} className="oauth-spinning" /> : <Upload size={16} />}
                          {bangumiUploading ? '正在同步...' : '同步到 Bangumi'}
                        </button>
                        <p className="settings-hint">对比本地与 Bangumi 的状态/评分/评论，不一致的上传更新</p>
                        {bangumiUploadResult && (
                          <div className="bangumi-upload-result" style={{ marginTop: '8px', fontSize: '13px' }}>
                            {bangumiUploadResult.error ? (
                              <span style={{ color: 'var(--error)' }}>同步失败: {bangumiUploadResult.error}</span>
                            ) : (
                              <>
                                <span style={{ color: 'var(--success)' }}>
                                  同步完成: 上传 {bangumiUploadResult.synced} 条，跳过 {bangumiUploadResult.skipped} 条（已一致），失败 {bangumiUploadResult.failed} 条
                                </span>
                                {bangumiUploadResult.errors && bangumiUploadResult.errors.length > 0 && (
                                  <details style={{ marginTop: '4px' }}>
                                    <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}>查看错误详情</summary>
                                    <ul style={{ color: 'var(--error)', fontSize: '12px', marginTop: '4px' }}>
                                      {bangumiUploadResult.errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}
                                    </ul>
                                  </details>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="account-bind-section">
                    <h4>GitHub</h4>
                    {GitHubAuthService.isBound() ? (
                      <div className="bangumi-bound-info">
                        <div className="bangumi-bound-user">
                          <img src={GitHubAuthService.getBoundAccount()?.avatar || FALLBACK_IMG} alt="" className="settings-avatar" loading="lazy" onError={e => { e.target.src = FALLBACK_IMG; }} />
                          <div>
                            <span className="bangumi-bound-name">{GitHubAuthService.getBoundAccount()?.nickname || GitHubAuthService.getBoundAccount()?.username || '已绑定'}</span>
                            <span className="settings-hint">GitHub 账号已绑定</span>
                          </div>
                        </div>
                        <button className="bangumi-unbind-btn" onClick={() => { GitHubAuthService.unbind(); setSettingsTab('bangumi'); }}>解除绑定</button>
                      </div>
                    ) : (
                      <>
                        <button className="bangumi-bind-btn" onClick={() => GitHubAuthService.initiateLogin()}>
                          <GitHubIcon size={16} /> 绑定 GitHub 账号
                        </button>
                        <p className="settings-hint">将跳转至 GitHub 进行授权</p>
                      </>
                    )}
                  </div>
                </div>
              )}
              {settingsTab === 'theme' && (
                <div className="settings-section">
                  <h3>主题外观</h3>
                  <p className="settings-desc">选择你喜欢的主题风格</p>
                  <div className="theme-options">
                    {[
                      { key: '', label: '浅色模式', desc: '清新明亮', color: '#F5F5F7' },
                      { key: 'dark', label: '深色模式', desc: '护眼舒适', color: '#1c1c1e' },
                      { key: 'high-contrast', label: '高对比度', desc: '清晰易读', color: '#ffffff' },
                    ].map(t => (
                      <button key={t.key} className={`theme-option ${(document.documentElement.getAttribute('data-theme') || '') === t.key ? 'active' : ''}`}
                        onClick={() => {
                          if (t.key) document.documentElement.setAttribute('data-theme', t.key);
                          else document.documentElement.removeAttribute('data-theme');
                          updateProfile({ preferences: { ...(currentUser?.preferences || {}), theme: t.key } });
                        }}>
                        <div className="theme-preview" style={{ background: t.color, border: '1px solid var(--border-primary)' }}>
                          <div className="theme-preview-bar" style={{ background: t.key === 'dark' ? '#f09bb3' : t.key === 'high-contrast' ? '#d63384' : '#e886a2' }} />
                        </div>
                        <span className="theme-label">{t.label}</span>
                        <span className="theme-desc">{t.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {settingsTab === 'data' && (
                <div className="settings-section">
                  <h3>数据管理</h3>
                  <div className="data-settings-list">
                    <div className="data-settings-item">
                      <div className="data-settings-info">
                        <Database size={16} />
                        <div>
                          <div className="data-settings-label">标记时收录到后端</div>
                          <div className="data-settings-desc">开启后，标记条目时自动将完整数据存入后端数据库，提升后续搜索和加载速度</div>
                        </div>
                      </div>
                      <label className="profile-settings-toggle">
                        <input type="checkbox" checked={dataSettings.auto_enrich} onChange={e => setDataSettings(s => ({ ...s, auto_enrich: e.target.checked }))} />
                        <span className="toggle-slider" />
                      </label>
                    </div>
                    <div className="data-settings-item">
                      <div className="data-settings-info">
                        <HardDrive size={16} />
                        <div>
                          <div className="data-settings-label">标记时保存到本地</div>
                          <div className="data-settings-desc">开启后，标记条目时同步保存到浏览器本地存储，可随时导出 CSV 备份</div>
                        </div>
                      </div>
                      <label className="profile-settings-toggle">
                        <input type="checkbox" checked={dataSettings.local_backup} onChange={e => setDataSettings(s => ({ ...s, local_backup: e.target.checked }))} />
                        <span className="toggle-slider" />
                      </label>
                    </div>
                  </div>
                  <div className="data-settings-actions">
                    <button className="data-settings-export-btn" onClick={handleExportCSV}>
                      <Download size={14} /> 导出收藏数据 (CSV)
                    </button>
                  </div>
                </div>
              )}
              {settingsTab === 'content' && (
                <div className="settings-section">
                  <h3>内容过滤</h3>
                  <div className="data-settings-list">
                    <div className="data-settings-item">
                      <div className="data-settings-info">
                        <ShieldOff size={16} />
                        <div>
                          <div className="data-settings-label">屏蔽限制级内容</div>
                          <div className="data-settings-desc">开启后，搜索结果、首页推荐中将不显示限制级（NSFW/R18）内容</div>
                        </div>
                      </div>
                      <label className="profile-settings-toggle">
                        <input type="checkbox" checked={filterNsfw} onChange={e => toggleFilterNsfw(e.target.checked)} />
                        <span className="toggle-slider" />
                      </label>
                    </div>
                  </div>
                  <h3 style={{ marginTop: 20 }}>点击特效</h3>
                  <div className="data-settings-list">
                    <div className="data-settings-item">
                      <div className="data-settings-info">
                        <Sparkles size={16} />
                        <div>
                          <div className="data-settings-label">点击烟花特效</div>
                          <div className="data-settings-desc">点击页面时显示粉色粒子烟花效果</div>
                        </div>
                      </div>
                      <label className="profile-settings-toggle">
                        <input type="checkbox" checked={fireworkEnabled} onChange={e => { const v = e.target.checked; setFireworkEnabled(v); setFireworkOn(v); }} />
                        <span className="toggle-slider" />
                      </label>
                    </div>
                    <div className="data-settings-item">
                      <div className="data-settings-info">
                        <MousePointerClick size={16} />
                        <div>
                          <div className="data-settings-label">点击台词特效</div>
                          <div className="data-settings-desc">点击页面时显示爆裂魔法台词，向上浮动并淡出</div>
                        </div>
                      </div>
                      <label className="profile-settings-toggle">
                        <input type="checkbox" checked={clickTextEnabled} onChange={e => { const v = e.target.checked; setClickTextEnabled(v); setClickTextOn(v); }} />
                        <span className="toggle-slider" />
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
