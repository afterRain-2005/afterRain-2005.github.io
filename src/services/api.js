import { StorageService } from './storage';
import oauthConfig from '../../oauth.config.js';
import { openDB } from 'idb';

const { STORAGE_KEYS: SK } = StorageService;

// ─── Cloudflare Worker 后端 API 基础地址 ───
// 注：硬编码线上域名，避免被 GitHub Actions 的 VITE_OAUTH_PROXY_URL secret 覆盖
const API_BASE = 'https://anispace-oauth-proxy.lyw2373314970.workers.dev';

// ─── 后端 API 请求辅助函数 ───
async function apiRequest(path, options = {}) {
  const token = sessionStorage.getItem('acg_jwt_token');
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `API error ${res.status}`);
  }
  return res.json();
}

const CACHE_TTL = 30 * 60 * 1000;
const REQUEST_TIMEOUT = 10000;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];
const NON_RETRYABLE_STATUS = [400, 401, 403, 404, 405, 410];

class ApiError extends Error {
  constructor(message, status = 0, code = 'UNKNOWN') {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'ApiError';
  }

  get isRetryable() {
    if (NON_RETRYABLE_STATUS.includes(this.status)) return false;
    if (this.code === 'OFFLINE') return false;
    if (this.code === 'NETWORK_ERROR') return true;
    if (this.status >= 500) return true;
    if (this.status === 429) return true;
    return false;
  }

  get userMessage() {
    switch (this.code) {
      case 'OFFLINE': return '网络连接已断开，请检查网络设置';
      case 'NETWORK_ERROR': return '网络请求异常，请检查网络连接';
      case 'TIMEOUT': return '请求超时，请稍后重试';
      case 'RATE_LIMITED': return '请求过于频繁，请稍后再试';
      case 'NOT_FOUND': return '请求的内容不存在';
      case 'FORBIDDEN': return '无权访问该内容';
      case 'SERVER_ERROR': return '服务器暂时不可用，请稍后重试';
      case 'INVALID_DATA': return '返回数据格式异常';
      default: return this.message || '请求失败，请重试';
    }
  }
}

// ─── IndexedDB 缓存管理器 (M-6) ───
// 替代 localStorage 缓存，防止过载，支持 LRU 淘汰

const IDB_DB = 'anispace-cache';
const IDB_STORE = 'bangumi-cache';
const MAX_CACHE_ENTRIES = 200;

let _dbPromise = null;

function getDB() {
  if (!_dbPromise) {
    _dbPromise = openDB(IDB_DB, 1, {
      upgrade(db) {
        db.createObjectStore(IDB_STORE, { keyPath: 'key' });
      },
    });
  }
  return _dbPromise;
}

class CacheManager {
  static async get(key) {
    try {
      const db = await getDB();
      const entry = await db.get(IDB_STORE, key);
      if (!entry) return null;
      if (Date.now() - entry.timestamp > CACHE_TTL) {
        await db.delete(IDB_STORE, key);
        return null;
      }
      return entry.data;
    } catch {
      return null;
    }
  }

  static async set(key, data) {
    try {
      const db = await getDB();
      // LRU: 检查条目数，超过上限删除最早条目
      const count = await db.count(IDB_STORE);
      if (count >= MAX_CACHE_ENTRIES) {
        const all = await db.getAll(IDB_STORE);
        all.sort((a, b) => a.timestamp - b.timestamp);
        const toDelete = all.slice(0, Math.max(1, all.length - MAX_CACHE_ENTRIES + 1));
        const tx = db.transaction(IDB_STORE, 'readwrite');
        for (const entry of toDelete) {
          tx.store.delete(entry.key);
        }
        await tx.done;
      }
      await db.put(IDB_STORE, { key, data, timestamp: Date.now() });
    } catch {
      // IndexedDB 不可用时静默失败
    }
  }

  static async clear() {
    try {
      const db = await getDB();
      await db.clear(IDB_STORE);
    } catch {}
  }

  static async clearAll() {
    return this.clear();
  }
}

function isOnline() {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createTimeoutController(timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return { controller, timer };
}

function validateSubject(data) {
  if (!data || typeof data !== 'object') return null;
  return {
    id: data.id || 0,
    type: data.type || 0,
    name: data.name || '',
    name_cn: data.name_cn || '',
    summary: data.summary || '',
    images: data.images || {},
    rating: data.rating || { score: 0, total: 0, count: {} },
    tags: Array.isArray(data.tags) ? data.tags : [],
    eps: data.eps || 0,
    eps_count: data.eps_count || 0,
    air_date: data.air_date || '',
    air_weekday: data.air_weekday || 0,
    collection: data.collection || {},
    rank: data.rank || 0,
    meta: data.meta || '',
    date: data.date || '',
    platform: data.platform || '',
    volumes: data.volumes || 0,
    total_episodes: data.total_episodes || 0,
    infobox: Array.isArray(data.infobox) ? data.infobox : [],
    crt: Array.isArray(data.crt) ? data.crt : [],
    staff: Array.isArray(data.staff) ? data.staff : [],
    topic: Array.isArray(data.topic) ? data.topic : [],
    blog: Array.isArray(data.blog) ? data.blog : [],
    related: Array.isArray(data.related) ? data.related : [],
    _loadedAt: Date.now(),
  };
}

function normalizeSubject(item) {
  if (!item) return null;
  // 确保 Bangumi 图片 URL 使用 HTTPS
  const toHttps = (url) => (typeof url === 'string' && url.startsWith('http://')) ? url.replace('http://', 'https://') : url;
  const images = item.images || {};
  const httpsImages = {};
  for (const [key, val] of Object.entries(images)) {
    httpsImages[key] = toHttps(val);
  }
  return {
    id: item.id,
    type: item.type,
    name: item.name || '',
    name_cn: item.name_cn || item.nameCn || '',
    summary: item.summary || '',
    image: toHttps(item.images?.large || item.images?.common || item.images?.medium || item.image || ''),
    images: httpsImages,
    score: item.rating?.score || item.score || 0,
    rating: item.rating || { score: 0, total: 0, count: {} },
    tags: Array.isArray(item.tags)
      ? item.tags.map(t => typeof t === 'string' ? t : t.name).filter(Boolean)
      : [],
    eps: item.eps || item.eps_count || 0,
    air_date: item.air_date || '',
    platform: item.platform || '',
    rank: item.rank || 0,
    collection: item.collection || {},
    url: item.url || '',
    infobox: item.infobox || [],
    crt: item.crt || [],
    staff: item.staff || [],
  };
}

function generateId(items) {
  return items.length > 0 ? Math.max(...items.map(i => i.id)) + 1 : 1;
}

export { ApiError, CacheManager, isOnline, validateSubject, normalizeSubject, apiRequest };
export { StorageService } from './storage';

// ─── AuthService ───
// 登录/登出/当前用户：通过后端 API 创建或查找用户，JWT 存 localStorage
export const AuthService = {
  async loginWithOAuth(provider, oauthUser) {
    // 防御性校验：确保 OAuth 用户 ID 存在
    if (!oauthUser || !oauthUser.id) {
      console.error('[AuthService] loginWithOAuth: oauthUser.id is missing', oauthUser);
      return { error: 'OAuth 用户信息不完整，请重试' };
    }
    const body = {
      provider,
      providerId: String(oauthUser.id),
      username: oauthUser.username || `user_${Date.now()}`,
      name: oauthUser.nickname || oauthUser.username || '新用户',
      avatar: oauthUser.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${oauthUser.username || Date.now()}`,
      bio: oauthUser.bio || '',
    };
    const data = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    // 后端返回 { token, user }
    if (data.token) {
      sessionStorage.setItem('acg_jwt_token', data.token);
    }
    if (data.user) {
      StorageService.set(SK.CURRENT_USER, data.user);
    }
    return { user: data.user, token: data.token };
  },

  logout() {
    sessionStorage.removeItem('acg_jwt_token');
    StorageService.remove(SK.AUTH_TOKEN);
    StorageService.remove(SK.CURRENT_USER);
  },

  getCurrentUser() {
    return StorageService.get(SK.CURRENT_USER);
  },

  isAuthenticated() {
    return !!sessionStorage.getItem('acg_jwt_token') || !!StorageService.get(SK.AUTH_TOKEN);
  },

  async updateProfile(userId, updates) {
    const user = await apiRequest(`/api/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    // 同步更新本地缓存
    const cur = StorageService.get(SK.CURRENT_USER);
    if (cur && cur.id === userId) {
      StorageService.set(SK.CURRENT_USER, user);
    }
    return { user };
  },
};

// ─── UserService ───
// getById 保留同步版本（从本地缓存读取）以兼容大量调用处；fetchById 走后端 API
export const UserService = {
  getById(id) {
    // 优先从当前用户匹配
    const cur = StorageService.get(SK.CURRENT_USER);
    if (cur && cur.id === id) return cur;
    // 其次从用户缓存中查找
    const users = StorageService.get(SK.USERS, []);
    return users.find(u => u.id === id) || null;
  },

  async fetchById(id) {
    const user = await apiRequest(`/api/users/${id}`);
    // 更新本地缓存
    const users = StorageService.get(SK.USERS, []);
    const idx = users.findIndex(u => u.id === id);
    if (idx !== -1) users[idx] = user;
    else users.push(user);
    StorageService.set(SK.USERS, users);
    return user;
  },

  search(query) {
    const users = StorageService.get(SK.USERS, []);
    const cur = StorageService.get(SK.CURRENT_USER);
    // 将当前用户也纳入搜索范围
    const pool = cur ? [cur, ...users.filter(u => u.id !== cur.id)] : users;
    return pool.filter(u => u.name?.includes(query) || u.username?.includes(query));
  },

  // 保留 getAll 以兼容，返回当前用户
  getAll() {
    const cur = StorageService.get(SK.CURRENT_USER);
    return cur ? [cur] : [];
  },

  async getProfile(userId) {
    return apiRequest(`/api/users/${userId}/profile`);
  },

  async updateSettings(userId, settings) {
    return apiRequest(`/api/users/${userId}/settings`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  },

  async getUserComments(userId) {
    return apiRequest(`/api/users/${userId}/comments`);
  },

  async getUserActivity(userId) {
    return apiRequest(`/api/users/${userId}/activity`);
  },
};

// ─── FollowService ───
// 从原 UserService 拆出，走后端 API
export const FollowService = {
  async toggleFollow(fromUserId, toUserId) {
    return await apiRequest(`/api/follows/${toUserId}`, {
      method: 'POST',
      body: JSON.stringify({ fromUserId }),
    });
  },

  // Worker GET /api/follows/:userId 返回 { following, followers }
  // 提取对应字段供组件使用
  async _getFollowData(userId) {
    const data = await apiRequest(`/api/follows/${userId}`);
    return data; // { following: [...], followers: [...] }
  },

  async getFollowers(userId) {
    const data = await this._getFollowData(userId);
    return data.followers || [];
  },

  async getFollowing(userId) {
    const data = await this._getFollowData(userId);
    return data.following || [];
  },

  // 保留同步方法签名兼容旧代码（从本地缓存读取）
  isFollowing(currentUserId, targetUserId) {
    const follows = StorageService.get(SK.FOLLOWS, []);
    return follows.some(f => f.from === currentUserId && f.to === targetUserId);
  },

  // ── 异步方法（走后端 API） ──
  async isFollowingAsync(fromUserId, toUserId) {
    const result = await apiRequest(`/api/follows/check?fromUserId=${fromUserId}&toUserId=${toUserId}`);
    return result.following === true;
  },
};

// ─── FriendService ───
// 好友系统，走后端 API
export const FriendService = {
  // 搜索用户
  async searchUsers(keyword, limit = 10) {
    return apiRequest(`/api/users/search?q=${encodeURIComponent(keyword)}&limit=${limit}`);
  },

  // 获取用户公开信息
  async getUserPublic(userId) {
    return apiRequest(`/api/users/${userId}/profile`);
  },

  // 发送好友请求
  async sendFriendRequest(toUserId, message = '') {
    return apiRequest('/api/friends/request', {
      method: 'POST',
      body: JSON.stringify({ to_user_id: toUserId, message }),
    });
  },

  // 获取收到的好友请求
  async getReceivedRequests() {
    return apiRequest('/api/friends/requests/received');
  },

  // 获取发出的好友请求
  async getSentRequests() {
    return apiRequest('/api/friends/requests/sent');
  },

  // 处理好友请求（接受/拒绝）
  async handleFriendRequest(requestId, status) {
    return apiRequest(`/api/friends/request/${requestId}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
  },

  // 删除好友
  async removeFriend(userId) {
    return apiRequest(`/api/friends/${userId}`, {
      method: 'DELETE',
    });
  },

  // 获取好友列表
  async getFriendList(page = 1, limit = 20) {
    return apiRequest(`/api/friends?page=${page}&limit=${limit}`);
  },

  // 获取与某用户的好友状态
  async getFriendStatus(userId) {
    return apiRequest(`/api/friends/status/${userId}`);
  },
};

// ─── FriendPostService ───
// 好友空间动态，走后端 API
export const FriendPostService = {
  async getFeed(page = 1, limit = 20) {
    return apiRequest(`/api/friend-posts?page=${page}&limit=${limit}`);
  },

  async createPost(content, visibility = 'friends', images = []) {
    return apiRequest('/api/friend-posts', {
      method: 'POST',
      body: JSON.stringify({ content, visibility, images }),
    });
  },

  async toggleLike(postId) {
    return apiRequest(`/api/friend-posts/${postId}/like`, {
      method: 'POST',
    });
  },

  async addComment(postId, content) {
    return apiRequest(`/api/friend-posts/${postId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  },

  async getComments(postId) {
    return apiRequest(`/api/friend-posts/${postId}/comments`);
  },

  async deletePost(postId) {
    return apiRequest(`/api/friend-posts/${postId}`, {
      method: 'DELETE',
    });
  },
};

// ─── ForumService ───
// 帖子、回复、点赞，走后端 API
export const ForumService = {
  async getPosts(page = 1, limit = 50, category = '', sort = 'latest', authorId = '') {
    const params = new URLSearchParams({ page, limit });
    if (category) params.set('category', category);
    if (sort && sort !== 'latest') params.set('sort', sort);
    if (authorId) params.set('authorId', authorId);
    return await apiRequest(`/api/posts?${params}`);
  },

  async getPostById(id, replySort = 'oldest') {
    return await apiRequest(`/api/posts/${id}?reply_sort=${replySort}`);
  },

  async createPost(data) {
    return await apiRequest('/api/posts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async addReply(postId, content, parentId = null) {
    const body = { content };
    if (parentId) body.parent_id = parentId;
    return await apiRequest(`/api/posts/${postId}/replies`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async toggleLike(postId) {
    return await apiRequest(`/api/posts/${postId}/like`, {
      method: 'POST',
    });
  },

  async deletePost(postId) {
    return await apiRequest(`/api/posts/${postId}`, {
      method: 'DELETE',
    });
  },

  async toggleReplyLike(replyId) {
    return await apiRequest(`/api/replies/${replyId}/like`, {
      method: 'POST',
    });
  },

  async uploadImage(file) {
    const token = sessionStorage.getItem('acg_jwt_token');
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/api/uploads`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `上传失败 ${res.status}`);
    }
    return res.json();
  },
};

// ─── CollectionMarkService ───
// 收藏标记，走后端 API
export const CollectionMarkService = {
  MARKS: { WISH: 'wish', COLLECT: 'collect', DOING: 'doing', ON_HOLD: 'on_hold', DROPPED: 'dropped' },
  MARK_LABELS: { wish: '想看', collect: '看过', doing: '在看', on_hold: '搁置', dropped: '抛弃' },
  // 根据条目类型返回对应标签：type 1=小说, 2=动画, 4=游戏, 6=三次元
  getMarkLabels(subjectType) {
    const t = Number(subjectType);
    if (t === 1) return { wish: '想读', collect: '读过', doing: '在读', on_hold: '搁置', dropped: '抛弃' };
    if (t === 4) return { wish: '想玩', collect: '玩过', doing: '在玩', on_hold: '搁置', dropped: '抛弃' };
    return { wish: '想看', collect: '看过', doing: '在看', on_hold: '搁置', dropped: '抛弃' };
  },
  MARK_COLORS: { wish: 'var(--secondary)', collect: 'var(--success)', doing: 'var(--accent-warm)', on_hold: 'var(--tag-novel)', dropped: 'var(--error)' },
  LOCAL_BACKUP_KEY: 'acg_local_backup_marks',

  async getByUserId(userId) {
    return await apiRequest(`/api/collections?userId=${userId}`);
  },

  async upsert(data) {
    const result = await apiRequest('/api/collections', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    // 本地备份：检查开关后自动保存
    this.saveToLocalBackup(data);

    // 自动同步到 Bangumi（如果已绑定）
    const bangumiToken = BangumiAuthService.getValidToken();
    if (bangumiToken && result && !result.error) {
      try {
        await apiRequest('/api/bangumi-sync/collection', {
          method: 'POST',
          body: JSON.stringify({
            subjectId: data.subjectId,
            status: data.status,
            rating: data.rating || 0,
            comment: data.comment || '',
            bangumiToken,
          }),
        });
      } catch (err) {
        console.warn('Bangumi 同步失败:', err);
      }
    }

    return result;
  },

  async remove(userId, subjectId) {
    const result = await apiRequest(`/api/collections/${subjectId}?userId=${userId}`, {
      method: 'DELETE',
    });
    this.removeFromLocalBackup(subjectId);
    return result;
  },

  // ─── 本地备份 ───
  isLocalBackupEnabled() {
    const settings = StorageService.get('acg_data_settings');
    return settings?.local_backup === true;
  },

  saveToLocalBackup(data) {
    if (!this.isLocalBackupEnabled()) return;
    const marks = StorageService.get(this.LOCAL_BACKUP_KEY, []);
    const idx = marks.findIndex(m => m.subject_id === data.subjectId);
    const entry = {
      subject_id: data.subjectId,
      subject_name: data.subjectName || '',
      subject_image: data.subjectImage || '',
      subject_type: data.subjectType || 2,
      status: data.status,
      rating: data.rating ?? 0,
      comment: data.comment || '',
      saved_at: new Date().toISOString(),
    };
    if (idx >= 0) marks[idx] = entry;
    else marks.push(entry);
    StorageService.set(this.LOCAL_BACKUP_KEY, marks);
  },

  removeFromLocalBackup(subjectId) {
    const marks = StorageService.get(this.LOCAL_BACKUP_KEY, []);
    const filtered = marks.filter(m => m.subject_id !== subjectId);
    StorageService.set(this.LOCAL_BACKUP_KEY, filtered);
  },

  getLocalBackup() {
    return StorageService.get(this.LOCAL_BACKUP_KEY, []);
  },

  // 保留兼容旧代码的同步方法（从本地缓存读取）
  getMark(userId, subjectId) {
    const marks = StorageService.get(SK.COLLECTION_MARKS, []);
    return marks.find(m => m.key === `${userId}_${subjectId}`) || null;
  },

  getUserMarks(userId, markType = null) {
    const marks = StorageService.get(SK.COLLECTION_MARKS, []);
    return marks.filter(m => m.userId === userId && (!markType || m.mark === markType));
  },

  getMarkCounts(userId) {
    const marks = this.getUserMarks(userId);
    const counts = { wish: 0, collect: 0, doing: 0, on_hold: 0, dropped: 0 };
    marks.forEach(m => { if (counts[m.mark] !== undefined) counts[m.mark]++; });
    return counts;
  },
};

// ─── NotificationService ───
// 通知，走后端 API
export const NotificationService = {
  async getByUserId(userId) {
    return await apiRequest(`/api/notifications?userId=${userId}`);
  },

  async markAsRead(userId, ids) {
    return await apiRequest('/api/notifications/read', {
      method: 'PUT',
      body: JSON.stringify({ userId, ids }),
    });
  },

  async markAllAsRead(userId) {
    return await apiRequest('/api/notifications/read', {
      method: 'PUT',
      body: JSON.stringify({ userId, all: true }),
    });
  },

  // 保留 add 方法用于本地即时通知（非持久化，关闭标签页丢失）
  // @deprecated 请使用 addAsync() 走后端 API 创建持久化通知
  add(userId, type, title, content, link = '') {
    const n = StorageService.get(SK.NOTIFICATIONS, []);
    n.unshift({ id: generateId(n), userId, type, title, content, link, read: false, createdAt: new Date().toISOString() });
    StorageService.set(SK.NOTIFICATIONS, n);
  },

  // 保留同步方法兼容旧代码（仅读取本地缓存，不跨设备同步）
  // @deprecated 请使用 getByUserId() 走后端 API
  getUnread(userId) { return StorageService.get(SK.NOTIFICATIONS, []).filter(n => n.userId === userId && !n.read); },
  // @deprecated 请使用 getByUserId() 走后端 API
  getAll(userId) { return StorageService.get(SK.NOTIFICATIONS, []).filter(n => n.userId === userId); },
  // @deprecated 请使用 markAsRead() 走后端 API
  markRead(id) { const n = StorageService.get(SK.NOTIFICATIONS, []); const item = n.find(x => x.id === id); if (item) item.read = true; StorageService.set(SK.NOTIFICATIONS, n); },
  // @deprecated 请使用 markAllAsRead() 走后端 API
  markAllRead(userId) { const n = StorageService.get(SK.NOTIFICATIONS, []); n.forEach(x => { if (x.userId === userId) x.read = true; }); StorageService.set(SK.NOTIFICATIONS, n); },

  // ── 异步方法（走后端 API） ──
  async addAsync(userId, type, fromUserId, targetType, targetId, content) {
    return apiRequest('/api/notifications', {
      method: 'POST',
      body: JSON.stringify({ userId, type, fromUserId: fromUserId || 0, targetType: targetType || '', targetId: targetId || 0, content: content || '' }),
    });
  },
  async getUnreadAsync(userId) {
    return apiRequest(`/api/notifications?userId=${userId}&unread=true`);
  },
};

// ─── WorldChannelService ───
// 世界频道消息，走后端 API
export const WorldChannelService = {
  async getMessages(page = 1, limit = 50) {
    return await apiRequest(`/api/world-messages?page=${page}&limit=${limit}`);
  },

  async sendMessage(content) {
    return await apiRequest('/api/world-messages', {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  },
};

// ─── NewsService ───
// 自定义新闻，走后端 API
export const NewsService = {
  async getCustomNews(page = 1, limit = 20, authorId = '') {
    const params = new URLSearchParams({ page, limit });
    if (authorId) params.set('authorId', authorId);
    return await apiRequest(`/api/news?${params}`);
  },

  async createNews(data) {
    return await apiRequest('/api/news', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getNewsById(id) {
    return await apiRequest(`/api/news/${id}`);
  },

  async updateNews(id, data) {
    return await apiRequest(`/api/news/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteNews(id) {
    return await apiRequest(`/api/news/${id}`, {
      method: 'DELETE',
    });
  },

  // 聚合资讯流（爬取的多源数据）
  async getNewsFeed({ page = 1, limit = 20, source = '', category = '' } = {}) {
    const params = new URLSearchParams({ page, limit });
    if (source) params.set('source', source);
    if (category) params.set('category', category);
    return await apiRequest(`/api/news/feed?${params.toString()}`);
  },

  // 实时刷新指定源
  async refreshSource(source) {
    return await apiRequest(`/api/news/refresh?source=${encodeURIComponent(source)}`);
  },
};

// ─── AniBTService ───
// AniBT 番剧数据代理，走 Worker /api/anibt/*
export const AniBTService = {
  async getSeasonAnime(season = '') {
    const params = new URLSearchParams();
    if (season) params.set('season', season);
    return await apiRequest(`/api/anibt/api/seasons/anime${params.toString() ? '?' + params.toString() : ''}`);
  },

  async getAnimeGroups(bgmId) {
    if (!bgmId) return { ok: false, data: { groups: [] } };
    return await apiRequest(`/api/anibt/api/anime/groups?bgmId=${bgmId}`);
  },
};

// ─── Wenku8Service ───
// 轻小说文库代理，走 Worker /api/wenku8/*
export const Wenku8Service = {
  // 搜索轻小说（按书名搜索 merged.csv）
  async searchNovel(keyword) {
    if (!keyword) return [];
    return await apiRequest(`/api/wenku8/search?q=${encodeURIComponent(keyword)}`);
  },

  // 获取小说章节列表
  async getChapters(bookId) {
    if (!bookId) return { volumes: [] };
    return await apiRequest(`/api/wenku8/chapters?bookId=${encodeURIComponent(bookId)}`);
  },

  // 获取章节正文内容
  async getChapterContent(chapterUrl) {
    if (!chapterUrl) return { title: '', content: '' };
    return await apiRequest(`/api/wenku8/content?chapterUrl=${encodeURIComponent(chapterUrl)}`);
  },

  // 从 novel_link 提取 bookId
  // e.g. "https://www.wenku8.net/book/3020.htm" → "3020"
  extractBookId(novelLink) {
    if (!novelLink) return null;
    const match = novelLink.match(/\/book\/(\d+)\.htm/);
    return match ? match[1] : null;
  },
};

// ─── UserGuestbookService ───
// 用户留言板，走后端 API
export const UserGuestbookService = {
  async getMessages(userId, page = 1, limit = 20) {
    return apiRequest(`/api/user-guestbook/${userId}?page=${page}&limit=${limit}`);
  },

  async postMessage(userId, content, reply_to_id = null) {
    return apiRequest(`/api/user-guestbook/${userId}`, {
      method: 'POST',
      body: JSON.stringify({ content, reply_to_id }),
    });
  },

  async deleteMessage(userId, messageId) {
    return apiRequest(`/api/user-guestbook/${userId}/${messageId}`, {
      method: 'DELETE',
    });
  },

  async updateGuestbookSettings(userId, allow_guestbook) {
    return apiRequest(`/api/users/${userId}/guestbook-settings`, {
      method: 'PUT',
      body: JSON.stringify({ allow_guestbook }),
    });
  },

  async updateProfileVisibility(userId, settings) {
    return apiRequest(`/api/users/${userId}/profile-visibility`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  },
};

// ─── BangumiService ───
// 保持不变，仍使用 Bangumi API 代理
export const BangumiService = {
  BASE_URL: 'https://api.bgm.tv',
  USER_AGENT: 'ANISpace/1.0 (https://github.com/anispace)',

  _proxyUrl(url) {
    const proxyBase = oauthConfig.proxyUrl;
    if (!proxyBase) return url;
    return url.replace(this.BASE_URL, `${proxyBase}/api/bangumi`);
  },

  _headers() {
    const headers = { 'User-Agent': this.USER_AGENT, 'Accept': 'application/json' };
    const token = StorageService.get('acg_bangumi_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  },

  _cacheKey(endpoint, params = '') {
    return `bgm_${endpoint}_${params}`;
  },

  // ─── 请求去重：同一 cacheKey 复用进行中的请求 ───
  _inFlight: new Map(),

  async _request(url, cacheKey = null, useCache = true, retryCount = 0, fetchOptions = {}) {
    // 请求去重：如果已有相同 cacheKey 的请求正在进行，直接复用
    const dedupKey = cacheKey || url;
    if (this._inFlight.has(dedupKey)) {
      return this._inFlight.get(dedupKey);
    }

    const promise = this._doRequest(url, cacheKey, useCache, retryCount, fetchOptions);
    this._inFlight.set(dedupKey, promise);
    try {
      return await promise;
    } finally {
      this._inFlight.delete(dedupKey);
    }
  },

  async _doRequest(url, cacheKey, useCache, retryCount, fetchOptions) {
    if (!isOnline()) {
      if (useCache && cacheKey) {
        const cached = await CacheManager.get(cacheKey);
        if (cached) return cached;
      }
      throw new ApiError('网络连接已断开，请检查网络设置', 0, 'OFFLINE');
    }

    if (useCache && cacheKey) {
      const cached = await CacheManager.get(cacheKey);
      if (cached) return cached;
    }

    try {
      const { controller, timer } = createTimeoutController(REQUEST_TIMEOUT);
      const targetUrl = this._proxyUrl(url);
      const { method, body, headers: extraHeaders } = fetchOptions;
      const res = await fetch(targetUrl, {
        method: method || 'GET',
        headers: { ...this._headers(), ...(extraHeaders || {}) },
        ...(body ? { body } : {}),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        let code = 'API_ERROR';
        if (res.status === 429) code = 'RATE_LIMITED';
        else if (res.status === 404) code = 'NOT_FOUND';
        else if (res.status === 403) code = 'FORBIDDEN';
        else if (res.status >= 500) code = 'SERVER_ERROR';

        const error = new ApiError(`API请求失败 (${res.status})`, res.status, code);

        if (error.isRetryable && retryCount < MAX_RETRIES) {
          await sleep(RETRY_DELAYS[retryCount] || 4000);
          return this._doRequest(url, cacheKey, false, retryCount + 1, fetchOptions);
        }

        throw error;
      }

      const data = await res.json();

      // Bangumi API 对 NSFW/已删除条目返回 HTTP 200 但 body 含 {"code":404}
      // 需要检测此模式并抛出正确的错误，否则 validateSubject 会收到无 id 的数据
      if (data && data.code === 404 && data.error) {
        throw new ApiError('请求的内容不存在或为限制级内容', 404, 'NOT_FOUND');
      }

      if (cacheKey) await CacheManager.set(cacheKey, data);
      return data;
    } catch (err) {
      if (err instanceof ApiError) throw err;

      if (err.name === 'AbortError') {
        const error = new ApiError('请求超时，请稍后重试', 0, 'TIMEOUT');
        if (retryCount < MAX_RETRIES) {
          await sleep(RETRY_DELAYS[retryCount] || 4000);
          return this._doRequest(url, cacheKey, false, retryCount + 1, fetchOptions);
        }
        throw error;
      }

      const error = new ApiError('网络请求异常，请检查网络连接', 0, 'NETWORK_ERROR');
      if (retryCount < MAX_RETRIES) {
        await sleep(RETRY_DELAYS[retryCount] || 4000);
        return this._doRequest(url, cacheKey, false, retryCount + 1, fetchOptions);
      }
      throw error;
    }
  },

  async searchSubjects(keyword, type = 0, limit = 20, offset = 0) {
    // 使用 GET /search/subject/{keywords} 端点（与 Bangumi 站内搜索一致，结果更全）
    const encodedKeyword = encodeURIComponent(keyword);
    let url = `${this.BASE_URL}/search/subject/${encodedKeyword}?responseGroup=small&start=${offset}&max_results=${limit}`;
    if (type && type > 0) {
      url += `&type=${type}`;
    }
    const cacheKey = this._cacheKey('search', `${keyword}_${type}_${limit}_${offset}`);

    try {
      const data = await this._request(url, cacheKey, true, 0);
      if (data && data.list) {
        return {
          list: data.list.map(normalizeSubject).filter(Boolean),
          results: data.results || 0,
          total: data.results || 0,
          offset: offset,
          limit: limit,
        };
      }
      return { list: [], results: 0, total: 0, offset: 0, limit };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError('搜索请求异常', 0, 'NETWORK_ERROR');
    }
  },

  async getSubject(id) {
    const url = `${this.BASE_URL}/v0/subjects/${id}`;
    const data = await this._request(url, this._cacheKey('subject', String(id)));
    return validateSubject(data);
  },

  async getSubjectDetail(id) {
    // Use v0 API (more stable, 300s cache, recommended by Bangumi)
    const url = `${this.BASE_URL}/v0/subjects/${id}`;
    const data = await this._request(url, this._cacheKey('subject_detail', String(id)));
    return validateSubject(data);
  },

  /**
   * 批量检查条目可访问性（用于过滤 NSFW/已删除条目）
   * 使用 /v0/subjects/{id} 端点，NSFW 条目返回 404
   * @param {Array<{id: number}>} items - 搜索结果列表
   * @returns {Promise<Set<number>>} 不可访问的条目 ID 集合
   */
  async checkAccessibility(items) {
    if (!items || items.length === 0) return new Set();
    const inaccessibleIds = new Set();
    const checks = items.map(item =>
      fetch(this._proxyUrl(`${this.BASE_URL}/v0/subjects/${item.id}`), {
        method: 'GET',
        headers: this._headers(),
        signal: AbortSignal.timeout(3000),
      })
        .then(res => { if (res.status === 404) inaccessibleIds.add(item.id); })
        .catch(() => { /* 超时或网络错误，不标记为不可访问 */ })
    );
    await Promise.allSettled(checks);
    return inaccessibleIds;
  },

  async getCalendar() {
    const url = `${this.BASE_URL}/calendar`;
    const data = await this._request(url, this._cacheKey('calendar'), true);
    if (Array.isArray(data)) {
      return data.map(day => ({
        ...day,
        items: (day.items || []).map(normalizeSubject),
      }));
    }
    return data;
  },

  async getPopular(type, limit = 10, offset = 0) {
    // /browse 端点已废弃(404)，改用 calendar 数据提取高分条目
    const typeMap = { anime: 2, novel: 1, game: 4 };
    const subjectType = typeMap[type] || 2;
    try {
      const calendarData = await this.getCalendar();
      if (!Array.isArray(calendarData)) return { data: [] };
      // 收集所有条目，按类型筛选
      const allItems = calendarData.flatMap(day => day.items || []);
      const filtered = allItems.filter(item => item.type === subjectType);
      // 按评分降序排列
      const sorted = filtered.sort((a, b) => (b.rating?.score || b.score || 0) - (a.rating?.score || a.score || 0));
      // 去重（同一 ID 可能出现在不同星期）
      const seen = new Set();
      const unique = sorted.filter(item => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
      const paged = unique.slice(offset, offset + limit);
      return { data: paged, total: unique.length };
    } catch {
      return { data: [] };
    }
  },

  async getSubjectsByTag(tag, type = 2, limit = 10, offset = 0) {
    const url = `${this.BASE_URL}/search/subject/${encodeURIComponent(tag)}?type=${type}&limit=${limit}&offset=${offset}&responseGroup=small`;
    const result = await this._request(url, this._cacheKey('tag', `${tag}_${type}_${limit}_${offset}`));
    if (result && result.list) {
      result.list = result.list.map(normalizeSubject);
    }
    return result;
  },

  async browseSubjects(type = 2, sort = 'rank', limit = 30, offset = 0) {
    let url = `${this.BASE_URL}/v0/subjects?type=${type}&limit=${limit}&offset=${offset}`;
    if (sort) url += `&sort=${sort}`;
    const cacheKey = this._cacheKey('browse', `${type}_${sort}_${limit}_${offset}`);
    try {
      const data = await this._request(url, cacheKey, true, 300);
      if (data && Array.isArray(data.data)) {
        return {
          data: data.data.map(normalizeSubject).filter(Boolean),
          total: data.total || 0,
          limit: data.limit || limit,
          offset: data.offset || offset,
        };
      }
      return { data: [], total: 0, limit, offset };
    } catch {
      return { data: [], total: 0, limit, offset };
    }
  },

  async searchPersons(keyword, limit = 24, offset = 0) {
    const url = `${this.BASE_URL}/v0/persons?keyword=${encodeURIComponent(keyword)}&limit=${limit}&offset=${offset}`;
    const cacheKey = this._cacheKey('search_persons', `${keyword}_${limit}_${offset}`);
    const data = await this._request(url, cacheKey, true, 0, {
      method: 'GET',
    });
    return data || { data: [], total: 0 };
  },

  async getSubjectCharacters(id) {
    const url = `${this.BASE_URL}/v0/subjects/${id}/characters`;
    const data = await this._request(url, this._cacheKey('characters', String(id)));
    return Array.isArray(data) ? data : [];
  },

  async getSubjectPersons(id) {
    const url = `${this.BASE_URL}/v0/subjects/${id}/persons`;
    const data = await this._request(url, this._cacheKey('persons', String(id)));
    return Array.isArray(data) ? data : [];
  },

  async getSubjectEpisodes(id) {
    // v0 API: /v0/episodes?subject_id={id}&limit=200&offset=0
    const url = `${this.BASE_URL}/v0/episodes?subject_id=${id}&limit=200&offset=0`;
    const data = await this._request(url, this._cacheKey('episodes', String(id)));
    // v0 returns { data: [...], total: N, ... }
    if (data && Array.isArray(data.data)) return data.data;
    return Array.isArray(data) ? data : [];
  },

  async getRelatedSubjects(id) {
    const url = `${this.BASE_URL}/subject/${id}/related`;
    const data = await this._request(url, this._cacheKey('related', String(id)));
    return Array.isArray(data) ? data : [];
  },

  async getSubjectComments(id, limit = 20, offset = 0) {
    const url = `${this.BASE_URL}/subject/${id}/comments?limit=${limit}&offset=${offset}`;
    const data = await this._request(url, this._cacheKey('comments', `${id}_${limit}_${offset}`));
    return data || { comments: [], total: 0 };
  },

  async getSubjectBlog(id, limit = 10, offset = 0) {
    const url = `${this.BASE_URL}/subject/${id}/blog?limit=${limit}&offset=${offset}`;
    const data = await this._request(url, this._cacheKey('blog', `${id}_${limit}_${offset}`));
    return data || [];
  },

  async getSubjectReviews(id) {
    const url = `${this.BASE_URL}/subject/${id}/reviews`;
    const data = await this._request(url, this._cacheKey('reviews', String(id)));
    return data || [];
  },

  getTypeByCode(code) {
    const map = { 1: 'novel', 2: 'anime', 3: 'music', 4: 'game', 6: 'real' };
    return map[code] || 'anime';
  },

  getTypeLabel(code) {
    const map = { 1: '小说', 2: '动画', 3: '音乐', 4: '游戏', 6: '三次元' };
    return map[code] || '其他';
  },

  buildBangumiUrl(id) { return `https://bgm.tv/subject/${id}`; },
  buildSubjectWebUrl(id) { return `https://bgm.tv/subject/${id}`; },

  clearCache() { CacheManager.clearAll(); },

  async getRandomSubject(type = 0, excludeIds = []) {
    const HISTORY_KEY_PREFIX = 'acg_random_history';
    const MAX_HISTORY = 50;
    const SCORE_THRESHOLD = 6.5;
    // Bangumi type: 1=小说, 2=动画, 3=音乐, 4=游戏, 6=三次元
    const TYPE_MAP = { anime: 2, game: 4, novel: 1, real: 6 };
    const typeCode = typeof type === 'string' ? TYPE_MAP[type] : type; // 0=全部

    const getHistoryKey = () => `${HISTORY_KEY_PREFIX}_${typeCode || 'all'}`;
    const loadHistory = () => {
      try {
        const raw = localStorage.getItem(getHistoryKey());
        return raw ? JSON.parse(raw) : [];
      } catch { return []; }
    };
    const saveHistory = (ids) => {
      const trimmed = ids.slice(-MAX_HISTORY);
      try { localStorage.setItem(getHistoryKey(), JSON.stringify(trimmed)); } catch {}
    };

    const history = loadHistory();
    const allExcluded = [...new Set([...excludeIds, ...history])];

    const pickRandom = (candidates) => {
      if (candidates.length === 0) return null;
      const selected = candidates[Math.floor(Math.random() * candidates.length)];
      history.push(selected.id);
      saveHistory(history);
      return selected;
    };

    // 1. 动画类型优先从 calendar 获取（数据更丰富）
    if (typeCode === 2 || typeCode === 0) {
      try {
        const calendarData = await this.getCalendar();
        if (Array.isArray(calendarData)) {
          let allItems = calendarData.flatMap(day => day.items || []);
          if (typeCode === 2) allItems = allItems.filter(s => s.type === 2);
          const candidates = allItems
            .filter(s => s && s.id && !allExcluded.includes(s.id) && (s.rating?.score || s.score || 0) >= SCORE_THRESHOLD);
          if (candidates.length > 0) return pickRandom(candidates);
        }
      } catch {}
    }

    // 2. 使用 /v0/subjects 端点按类型浏览高分条目
    const typesToBrowse = typeCode === 0 ? [2, 4, 1, 6] : [typeCode];
    for (const t of typesToBrowse) {
      try {
        const result = await this.browseSubjects(t, 'rank', 50);
        if (result.data && result.data.length > 0) {
          const candidates = result.data
            .filter(s => s && s.id && !allExcluded.includes(s.id) && (s.rating?.score || s.score || 0) >= SCORE_THRESHOLD);
          if (candidates.length > 0) return pickRandom(candidates);
        }
      } catch {}
    }

    // 3. fallback: 降低评分要求再试一次
    for (const t of typesToBrowse) {
      try {
        const result = await this.browseSubjects(t, 'rank', 50);
        if (result.data && result.data.length > 0) {
          const candidates = result.data
            .filter(s => s && s.id && !allExcluded.includes(s.id) && (s.rating?.score || s.score || 0) > 5);
          if (candidates.length > 0) return pickRandom(candidates);
        }
      } catch {}
    }

    return null;
  },
};

// ─── RatingService ───
// 保持 localStorage 实现（暂无后端端点）
export const RatingService = {
  addRating(userId, subjectId, subjectType, score, content = '') {
    const ratings = StorageService.get(SK.RATINGS, []);
    const existing = ratings.find(r => r.userId === userId && r.subjectId === subjectId);
    if (existing) { existing.score = score; existing.content = content; existing.updatedAt = new Date().toISOString(); }
    else { ratings.push({ id: generateId(ratings), userId, subjectId, subjectType, score, content, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), likes: 0 }); }
    StorageService.set(SK.RATINGS, ratings); return { success: true };
  },
  getRatings(subjectId) { return StorageService.get(SK.RATINGS, []).filter(r => r.subjectId === subjectId); },
  getAverageScore(subjectId) { const r = this.getRatings(subjectId); return r.length === 0 ? 0 : (r.reduce((s, x) => s + x.score, 0) / r.length).toFixed(1); },
  getUserRating(userId, subjectId) { return StorageService.get(SK.RATINGS, []).find(r => r.userId === userId && r.subjectId === subjectId); },

  // ── 异步方法（走后端 API） ──
  async fetchRatings(subjectId) {
    return apiRequest(`/api/ratings?subjectId=${subjectId}`);
  },
  async fetchUserRating(userId, subjectId) {
    return apiRequest(`/api/ratings/user?userId=${userId}&subjectId=${subjectId}`);
  },
  async addRatingAsync(userId, subjectId, subjectType, score, content = '') {
    return apiRequest('/api/ratings', {
      method: 'POST',
      body: JSON.stringify({ subjectId, subjectType, score, content }),
    });
  },
  async getAverageScoreAsync(subjectId) {
    const ratings = await this.fetchRatings(subjectId);
    const list = Array.isArray(ratings) ? ratings : [];
    if (list.length === 0) return '0.0';
    return (list.reduce((s, r) => s + r.score, 0) / list.length).toFixed(1);
  },
};

// ─── BangumiCommentService ───
export const BangumiCommentService = {
  // 获取条目吐槽（短评）
  async getComments(subjectId, limit = 20, offset = 0) {
    return apiRequest(`/api/bangumi/subjects/${subjectId}/comments?limit=${limit}&offset=${offset}`);
  },

  // 获取条目长评（评论）
  async getReviews(subjectId, limit = 10, offset = 0) {
    return apiRequest(`/api/bangumi/subjects/${subjectId}/reviews?limit=${limit}&offset=${offset}`);
  },

  // 获取用户对该条目的收藏状态（含评分）
  async getUserCollection(subjectId) {
    return apiRequest(`/api/bangumi/collection/${subjectId}`);
  },
};

// ─── LikeService ───
// 保持 localStorage 实现（暂无后端端点）
export const LikeService = {
  toggle(userId, targetType, targetId) {
    let likes = StorageService.get(SK.LIKES, []);
    const key = `${userId}_${targetType}_${targetId}`;
    const existing = likes.find(l => l.key === key);
    if (existing) { likes = likes.filter(l => l !== existing); StorageService.set(SK.LIKES, likes); return { liked: false }; }
    likes.push({ key, userId, targetType, targetId, date: new Date().toISOString() });
    StorageService.set(SK.LIKES, likes); return { liked: true };
  },
  isLiked(userId, targetType, targetId) { return StorageService.get(SK.LIKES, []).some(l => l.key === `${userId}_${targetType}_${targetId}`); },
  getCount(targetType, targetId) { return StorageService.get(SK.LIKES, []).filter(l => l.targetType === targetType && l.targetId === targetId).length; },
};

// ─── FavoriteService ───
// 保持 localStorage 实现（暂无后端端点）
export const FavoriteService = {
  toggle(userId, targetType, targetId) {
    let favs = StorageService.get(SK.FAVORITES, []);
    const key = `${userId}_${targetType}_${targetId}`;
    const existing = favs.find(f => f.key === key);
    if (existing) { favs = favs.filter(f => f !== existing); StorageService.set(SK.FAVORITES, favs); return { favorited: false }; }
    favs.push({ key, userId, targetType, targetId, date: new Date().toISOString() });
    StorageService.set(SK.FAVORITES, favs); return { favorited: true };
  },
  isFavorited(userId, targetType, targetId) { return StorageService.get(SK.FAVORITES, []).some(f => f.key === `${userId}_${targetType}_${targetId}`); },
  getUserFavorites(userId, targetType) { return StorageService.get(SK.FAVORITES, []).filter(f => f.userId === userId && (!targetType || f.targetType === targetType)); },

  // ── 异步方法（走后端 API） ──
  async toggleAsync(userId, targetType, targetId) {
    return apiRequest('/api/favorites/toggle', {
      method: 'POST',
      body: JSON.stringify({ userId, targetType, targetId }),
    });
  },
  async isFavoritedAsync(userId, targetType, targetId) {
    return apiRequest(`/api/favorites/check?userId=${userId}&targetType=${targetType}&targetId=${targetId}`);
  },
  async getUserFavoritesAsync(userId, targetType) {
    return apiRequest(`/api/favorites?userId=${userId}&targetType=${targetType}`);
  },
};

// ─── PrivateMessageService ───
// 保持 localStorage 实现（暂无后端端点）
export const PrivateMessageService = {
  send(fromUserId, toUserId, content) {
    const msgs = StorageService.get(SK.PRIVATE_MESSAGES, []);
    msgs.push({ id: generateId(msgs), fromUserId, toUserId, content, createdAt: new Date().toISOString(), read: false });
    StorageService.set(SK.PRIVATE_MESSAGES, msgs);
    return { success: true };
  },

  getConversation(userId1, userId2) {
    const msgs = StorageService.get(SK.PRIVATE_MESSAGES, []);
    return msgs.filter(m => (m.fromUserId === userId1 && m.toUserId === userId2) || (m.fromUserId === userId2 && m.toUserId === userId1)).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  },

  getConversations(userId) {
    const msgs = StorageService.get(SK.PRIVATE_MESSAGES, []);
    const userMsgs = msgs.filter(m => m.fromUserId === userId || m.toUserId === userId);
    const convMap = {};
    userMsgs.forEach(m => {
      const otherId = m.fromUserId === userId ? m.toUserId : m.fromUserId;
      if (!convMap[otherId] || new Date(m.createdAt) > new Date(convMap[otherId].lastMessage.createdAt)) {
        convMap[otherId] = { otherUserId: otherId, lastMessage: m, unread: m.toUserId === userId && !m.read ? 1 : 0 };
      } else if (m.toUserId === userId && !m.read) {
        convMap[otherId].unread++;
      }
    });
    return Object.values(convMap).sort((a, b) => new Date(b.lastMessage.createdAt) - new Date(a.lastMessage.createdAt));
  },

  markAsRead(userId, otherUserId) {
    const msgs = StorageService.get(SK.PRIVATE_MESSAGES, []);
    msgs.forEach(m => { if (m.toUserId === userId && m.fromUserId === otherUserId) m.read = true; });
    StorageService.set(SK.PRIVATE_MESSAGES, msgs);
  },

  getUnreadCount(userId) {
    return StorageService.get(SK.PRIVATE_MESSAGES, []).filter(m => m.toUserId === userId && !m.read).length;
  },

  // ── 异步方法（走后端 API） ──
  async fetchConversations(userId) {
    return apiRequest(`/api/private-messages/conversations?userId=${userId}`);
  },
  async fetchConversation(userId, otherUserId) {
    return apiRequest(`/api/private-messages/conversation?userId=${userId}&otherUserId=${otherUserId}`);
  },
  async sendAsync(fromUserId, toUserId, content) {
    return apiRequest('/api/private-messages', {
      method: 'POST',
      body: JSON.stringify({ toUserId, content }),
    });
  },
  async markAsReadAsync(userId, otherUserId) {
    return apiRequest(`/api/private-messages/read?userId=${userId}&otherUserId=${otherUserId}`, { method: 'PUT' });
  },
};

// ─── MailService ───
// 保持 localStorage 实现（暂无后端端点）
export const MailService = {
  send(fromUserId, toUserId, subject, content, attachments = []) {
    const mails = StorageService.get(SK.MAILBOX, []);
    const toUser = StorageService.get(SK.USERS, []).find(u => u.id === toUserId);
    if (!toUser) return { error: '收件人不存在' };
    if (content.length > 5000) return { error: '邮件内容不能超过5000字' };
    for (const att of attachments) {
      if (att.size > 10 * 1024 * 1024) return { error: '附件大小不能超过10MB' };
      const allowed = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'text/plain'];
      if (!allowed.includes(att.type)) return { error: '不支持的附件类型' };
    }
    const mail = {
      id: generateId(mails),
      fromUserId,
      toUserId,
      subject: subject || '(无主题)',
      content,
      attachments: attachments.map(a => ({ name: a.name, size: a.size, type: a.type, data: a.data })),
      createdAt: new Date().toISOString(),
      read: false,
      starred: false,
      deletedBy: [],
      folder: 'inbox',
    };
    mails.push(mail);
    StorageService.set(SK.MAILBOX, mails);
    NotificationService.add(toUserId, 'mail', '收到新邮件', `${StorageService.get(SK.USERS, []).find(u => u.id === fromUserId)?.name || '用户'} 给你发了一封邮件`, `/mailbox`);
    return { success: true, mail };
  },

  getInbox(userId) {
    const mails = StorageService.get(SK.MAILBOX, []);
    return mails
      .filter(m => m.toUserId === userId && !m.deletedBy.includes(userId))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  getSent(userId) {
    const mails = StorageService.get(SK.MAILBOX, []);
    return mails
      .filter(m => m.fromUserId === userId && !m.deletedBy.includes(userId))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  getMail(mailId) {
    const mails = StorageService.get(SK.MAILBOX, []);
    return mails.find(m => m.id === mailId) || null;
  },

  markAsRead(mailId) {
    const mails = StorageService.get(SK.MAILBOX, []);
    const mail = mails.find(m => m.id === mailId);
    if (mail) { mail.read = true; StorageService.set(SK.MAILBOX, mails); }
  },

  toggleStar(mailId) {
    const mails = StorageService.get(SK.MAILBOX, []);
    const mail = mails.find(m => m.id === mailId);
    if (mail) { mail.starred = !mail.starred; StorageService.set(SK.MAILBOX, mails); return mail.starred; }
    return false;
  },

  deleteMail(mailId, userId) {
    const mails = StorageService.get(SK.MAILBOX, []);
    const mail = mails.find(m => m.id === mailId);
    if (mail) {
      mail.deletedBy.push(userId);
      if (mail.deletedBy.includes(mail.fromUserId) && mail.deletedBy.includes(mail.toUserId)) {
        const filtered = mails.filter(m => m.id !== mailId);
        StorageService.set(SK.MAILBOX, filtered);
      } else {
        StorageService.set(SK.MAILBOX, mails);
      }
    }
  },

  getUnreadCount(userId) {
    return this.getInbox(userId).filter(m => !m.read).length;
  },

  getConversationMails(userId1, userId2) {
    const mails = StorageService.get(SK.MAILBOX, []);
    return mails
      .filter(m => (m.fromUserId === userId1 && m.toUserId === userId2) || (m.fromUserId === userId2 && m.toUserId === userId1))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  },

  searchMails(userId, query) {
    const q = query.toLowerCase();
    const inbox = this.getInbox(userId);
    const sent = this.getSent(userId);
    const all = [...inbox, ...sent];
    const seen = new Set();
    return all.filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return m.subject.toLowerCase().includes(q) || m.content.toLowerCase().includes(q);
    });
  },

  // ── 异步方法（走后端 API） ──
  async fetchInbox(userId) {
    return apiRequest(`/api/mails/inbox?userId=${userId}`);
  },
  async fetchSent(userId) {
    return apiRequest(`/api/mails/sent?userId=${userId}`);
  },
  async fetchConversation(userId, otherUserId) {
    return apiRequest(`/api/mails/conversation?userId=${userId}&otherUserId=${otherUserId}`);
  },
  async sendAsync(fromUserId, toUserId, subject, content, attachments = []) {
    return apiRequest('/api/mails', {
      method: 'POST',
      body: JSON.stringify({ toUserId, subject, content, attachments }),
    });
  },
  async markAsReadAsync(mailId) {
    return apiRequest(`/api/mails/${mailId}/read`, { method: 'PUT' });
  },
  async toggleStarAsync(mailId) {
    return apiRequest(`/api/mails/${mailId}/star`, { method: 'PUT' });
  },
  async deleteMailAsync(mailId, userId) {
    return apiRequest(`/api/mails/${mailId}?userId=${userId}`, { method: 'DELETE' });
  },
  async getUnreadCountAsync(userId) {
    return apiRequest(`/api/mails/unread?userId=${userId}`);
  },
};

// ─── NetEaseMusicService ───
// 保持不变，仍使用网易云 API
export const NetEaseMusicService = {
  METING_API: 'https://api.i-meto.com/meting/api',
  _cache: {},

  async _metingRequest(params) {
    if (!isOnline()) throw new ApiError('网络连接已断开', 0, 'OFFLINE');
    const query = new URLSearchParams(params).toString();
    const cacheKey = `netease_meting_${query}`;
    if (this._cache[cacheKey]) return this._cache[cacheKey];
    try {
      const url = `${this.METING_API}?${query}`;
      const { controller, timer } = createTimeoutController(REQUEST_TIMEOUT);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new ApiError('网易云API请求失败', res.status);
      const data = await res.json();
      this._cache[cacheKey] = data;
      return data;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError('网易云API请求异常', 0, 'NETWORK_ERROR');
    }
  },

  async search(keyword, limit = 10) {
    const data = await this._metingRequest({
      type: 'search',
      id: keyword,
      server: 'netease',
    });
    const items = Array.isArray(data) ? data.slice(0, limit) : [];
    return items.map(song => ({
      id: song.id || song.url?.split('/').pop(),
      mid: '',
      name: song.name || song.title || '',
      artists: song.artist || '',
      album: song.album || '',
      albumCover: song.cover || song.pic || '',
      duration: (song.duration || 0) * 1000,
      url: song.url || '',
      lrc: song.lrc || '',
    }));
  },

  async getSongUrl(id) {
    const data = await this._metingRequest({
      type: 'url',
      id: String(id),
      server: 'netease',
    });
    if (typeof data === 'string') return data;
    if (Array.isArray(data) && data.length > 0) return data[0].url || data[0];
    if (data?.url) return data.url;
    return null;
  },

  async getPlaylistDetail(id) {
    const data = await this._metingRequest({
      type: 'playlist',
      id: String(id),
      server: 'netease',
    });
    if (!Array.isArray(data) || data.length === 0) return null;
    const songs = data.map(song => ({
      id: song.id || '',
      mid: '',
      name: song.name || song.title || '',
      artists: song.artist || '',
      album: song.album || '',
      albumCover: song.cover || song.pic || '',
      duration: (song.duration || 0) * 1000,
      url: song.url || '',
      lrc: song.lrc || '',
    }));
    return {
      name: '网易云歌单',
      tracks: songs,
      coverImgUrl: songs[0]?.albumCover || '',
    };
  },

  async getLyric(id) {
    const data = await this._metingRequest({
      type: 'lrc',
      id: String(id),
      server: 'netease',
    });
    if (typeof data === 'string') return data;
    return data?.lrc || '';
  },
};

// ─── BangumiAuthService ───
// 保持不变，仍使用 OAuth 代理流程
// 但 OAuth 回调后调用 AuthService.loginWithOAuth() 在 D1 中创建/查找用户
export const BangumiAuthService = {
  buildAuthUrl() {
    const redirectUri = `${window.location.origin}${oauthConfig.bangumi.redirectPath}`;
    // H-1: 生成随机 state 防 CSRF
    const state = crypto.randomUUID();
    sessionStorage.setItem('oauth_state_bangumi', state);
    const params = new URLSearchParams({
      client_id: oauthConfig.bangumi.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      state,
    });
    return `${oauthConfig.bangumi.authUrl}?${params.toString()}`;
  },

  initiateLogin(isBindMode = false) {
    if (isBindMode) {
      sessionStorage.setItem('oauth_mode_bind', '1');
    }
    window.location.href = this.buildAuthUrl();
  },

  async handleOAuthCallback(code) {
    try {
      const redirectUri = `${window.location.origin}${oauthConfig.bangumi.redirectPath}`;
      const res = await fetch(`${oauthConfig.tokenBase}/bangumi/token?code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(redirectUri)}`);
      const data = await res.json();
      if (data.error) return { error: data.error };
      return data;
    } catch (err) {
      return { error: err.message || 'Bangumi 授权服务异常' };
    }
  },

  async loginWithBangumi(code, existingOauthResult = null) {
    // 支持传入已有的 oauthResult，避免重复使用 code
    const oauthResult = existingOauthResult || await this.handleOAuthCallback(code);
    if (oauthResult.error) return { error: oauthResult.error };

    StorageService.set('acg_bangumi_token', oauthResult.access_token);
    if (oauthResult.refresh_token) StorageService.set('acg_bangumi_refresh', oauthResult.refresh_token);
    StorageService.set('acg_bangumi_user', oauthResult.user);
    // 记录 token 过期时间（Bangumi token 有效期约 7 天）
    if (oauthResult.expires_in) {
      const expiresAt = Date.now() + oauthResult.expires_in * 1000;
      StorageService.set('acg_bangumi_token_expires', expiresAt);
    }

    // 通过 AuthService 创建或登录用户（现在走后端 API）
    const result = await AuthService.loginWithOAuth('bangumi', oauthResult.user);
    return result;
  },

  async refreshToken() {
    const refreshToken = StorageService.get('acg_bangumi_refresh');
    if (!refreshToken) return { error: '无 refresh token' };

    try {
      const res = await fetch(`${oauthConfig.tokenBase}/bangumi/refresh?refresh_token=${encodeURIComponent(refreshToken)}`);
      const data = await res.json();
      if (data.error) return { error: data.error };

      StorageService.set('acg_bangumi_token', data.access_token);
      if (data.refresh_token) StorageService.set('acg_bangumi_refresh', data.refresh_token);
      if (data.expires_in) {
        const expiresAt = Date.now() + data.expires_in * 1000;
        StorageService.set('acg_bangumi_token_expires', expiresAt);
      }

      return { ok: true, access_token: data.access_token };
    } catch (err) {
      return { error: err.message || '刷新失败' };
    }
  },

  getValidToken() {
    const token = StorageService.get('acg_bangumi_token');
    const expiresAt = StorageService.get('acg_bangumi_token_expires');

    // Token 过期前 1 小时刷新
    if (expiresAt && Date.now() > expiresAt - 3600000) {
      this.refreshToken().catch(err => console.warn('Token 自动刷新失败:', err));
    }

    return token;
  },

  getBoundAccount() {
    return StorageService.get('acg_bangumi_user');
  },

  isBound() {
    return !!StorageService.get('acg_bangumi_token');
  },

  unbind() {
    StorageService.remove('acg_bangumi_token');
    StorageService.remove('acg_bangumi_refresh');
    StorageService.remove('acg_bangumi_user');
    StorageService.remove('acg_bangumi_token_expires');
  },

  // 绑定 Bangumi 账号到当前已登录用户（存入数据库）
  async bindToCurrentUser(oauthResult) {
    const jwt = sessionStorage.getItem('acg_jwt_token');
    if (!jwt) return { error: '请先登录' };

    // 同时保存到 localStorage 供前端使用
    StorageService.set('acg_bangumi_token', oauthResult.access_token);
    if (oauthResult.refresh_token) StorageService.set('acg_bangumi_refresh', oauthResult.refresh_token);
    StorageService.set('acg_bangumi_user', oauthResult.user);
    if (oauthResult.expires_in) {
      const expiresAt = Date.now() + oauthResult.expires_in * 1000;
      StorageService.set('acg_bangumi_token_expires', expiresAt);
    }

    try {
      const res = await fetch(`${API_BASE}/api/auth/bind-bangumi`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          accessToken: oauthResult.access_token,
          refreshToken: oauthResult.refresh_token,
          expiresAt: oauthResult.expires_in ? Math.floor((Date.now() + oauthResult.expires_in * 1000) / 1000) : null,
          bangumiUserId: oauthResult.user_id || oauthResult.user?.id,
          bangumiUsername: oauthResult.user?.username || '',
          bangumiAvatar: oauthResult.user?.avatar || '',
        }),
      });
      const data = await res.json();
      return data;
    } catch (err) {
      return { error: err.message || '绑定失败' };
    }
  },

  // 解绑 Bangumi 账号（从数据库删除）
  async unbindFromServer() {
    const jwt = sessionStorage.getItem('acg_jwt_token');
    if (!jwt) return { error: '请先登录' };

    try {
      const res = await fetch(`${API_BASE}/api/auth/unbind-bangumi`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${jwt}` },
      });
      const data = await res.json();
      // 同时清除本地存储
      if (data.ok) {
        this.unbind();
      }
      return data;
    } catch (err) {
      return { error: err.message || '解绑失败' };
    }
  },
};

// ─── GitHubAuthService ───
// 保持不变，仍使用 OAuth 代理流程
// 但 OAuth 回调后调用 AuthService.loginWithOAuth() 在 D1 中创建/查找用户
export const GitHubAuthService = {
  buildAuthUrl() {
    const redirectUri = `${window.location.origin}${oauthConfig.github.redirectPath}`;
    // H-1: 生成随机 state 防 CSRF
    const state = crypto.randomUUID();
    sessionStorage.setItem('oauth_state_github', state);
    const params = new URLSearchParams({
      client_id: oauthConfig.github.clientId,
      redirect_uri: redirectUri,
      scope: oauthConfig.github.scope,
      state,
    });
    return `${oauthConfig.github.authUrl}?${params.toString()}`;
  },

  initiateLogin() {
    window.location.href = this.buildAuthUrl();
  },

  async handleOAuthCallback(code) {
    try {
      const redirectUri = `${window.location.origin}${oauthConfig.github.redirectPath}`;
      const url = `${oauthConfig.tokenBase}/github/token?code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
      const res = await fetch(url);
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { return { error: `响应解析失败 (HTTP ${res.status}): ${text.substring(0, 200)}` }; }
      if (data.error) return { error: data.error };
      return data;
    } catch (err) {
      return { error: err.message || 'GitHub 授权服务异常' };
    }
  },

  async loginWithGitHub(code) {
    const oauthResult = await this.handleOAuthCallback(code);
    if (oauthResult.error) return { error: oauthResult.error };

    StorageService.set(SK.GITHUB_TOKEN, oauthResult.access_token);
    StorageService.set(SK.GITHUB_USER, oauthResult.user);

    // 通过 AuthService 创建或登录用户（现在走后端 API）
    const result = await AuthService.loginWithOAuth('github', oauthResult.user);
    return result;
  },

  getBoundAccount() {
    return StorageService.get(SK.GITHUB_USER);
  },

  isBound() {
    return !!StorageService.get(SK.GITHUB_TOKEN);
  },

  unbind() {
    StorageService.remove(SK.GITHUB_TOKEN);
    StorageService.remove(SK.GITHUB_USER);
  },
};

// ─── EmailAuthService ───
export const EmailAuthService = {
  async register({ email, username, password, turnstileToken }) {
    try {
      const res = await fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username, password, turnstileToken }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data.error || '注册失败' };
      return data;
    } catch (err) {
      return { error: err.message || '注册服务异常' };
    }
  },

  async login({ email, password, turnstileToken }) {
    try {
      const res = await fetch(`${API_BASE}/api/auth/login-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, turnstileToken }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data.error || '登录失败' };
      return data;
    } catch (err) {
      return { error: err.message || '登录服务异常' };
    }
  },
};

// ─── QQMusicService ───
// 保持不变，仍使用 QQ 音乐 API
export const QQMusicService = {
  METING_API: 'https://api.i-meto.com/meting/api',
  _cache: {},

  async _metingRequest(params) {
    if (!isOnline()) throw new ApiError('网络连接已断开', 0, 'OFFLINE');
    const query = new URLSearchParams(params).toString();
    const cacheKey = `qq_meting_${query}`;
    if (this._cache[cacheKey]) return this._cache[cacheKey];
    try {
      const url = `${this.METING_API}?${query}`;
      const { controller, timer } = createTimeoutController(REQUEST_TIMEOUT);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new ApiError('QQ音乐API请求失败', res.status);
      const data = await res.json();
      this._cache[cacheKey] = data;
      return data;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError('QQ音乐API请求异常', 0, 'NETWORK_ERROR');
    }
  },

  async search(keyword, limit = 20) {
    const data = await this._metingRequest({
      type: 'search',
      id: keyword,
      server: 'tencent',
    });
    const items = Array.isArray(data) ? data.slice(0, limit) : [];
    return items.map(song => ({
      id: song.id || song.url?.split('/').pop(),
      mid: song.mid || song.id || '',
      name: song.name || song.title || '',
      artists: song.artist || '',
      album: song.album || '',
      albumCover: song.cover || song.pic || '',
      duration: (song.duration || 0) * 1000,
      url: song.url || '',
      lrc: song.lrc || '',
    }));
  },

  async getSongUrl(songmid) {
    const data = await this._metingRequest({
      type: 'url',
      id: songmid,
      server: 'tencent',
    });
    if (typeof data === 'string') return data;
    if (Array.isArray(data) && data.length > 0) return data[0].url || data[0];
    if (data?.url) return data.url;
    return `https://ws.stream.qqmusic.qq.com/C400${songmid}.m4a?fromtag=38`;
  },

  async getPlaylistDetail(disstid) {
    const data = await this._metingRequest({
      type: 'playlist',
      id: String(disstid),
      server: 'tencent',
    });
    if (!Array.isArray(data) || data.length === 0) return null;
    const songs = data.map(song => ({
      id: song.id || '',
      mid: song.mid || song.id || '',
      name: song.name || song.title || '',
      artists: song.artist || '',
      album: song.album || '',
      albumCover: song.cover || song.pic || '',
      duration: (song.duration || 0) * 1000,
      url: song.url || '',
      lrc: song.lrc || '',
    }));
    return {
      name: 'QQ音乐歌单',
      songlist: songs,
      tracklist: songs,
      logo: songs[0]?.albumCover || '',
    };
  },

  async getLyric(songmid) {
    const data = await this._metingRequest({
      type: 'lrc',
      id: songmid,
      server: 'tencent',
    });
    if (typeof data === 'string') return data;
    return data?.lrc || '';
  },
};

// ─── JikanService (MyAnimeList API) ───
// 通过Worker代理调用Jikan API
export const JikanService = {
  async getAnime(id) {
    return apiRequest(`/api/jikan/anime/${id}`);
  },

  async getTopAnime(params = {}) {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/api/jikan/top/anime${query ? '?' + query : ''}`);
  },

  async getSeasonNow() {
    return apiRequest(`/api/jikan/seasons/now`);
  },

  async getSeason(year, season) {
    return apiRequest(`/api/jikan/seasons/${year}/${season}`);
  },

  async getAnimeRecommendations() {
    return apiRequest(`/api/jikan/recommendations/anime`);
  },

  async searchAnime(params = {}) {
    const query = new URLSearchParams(params).toString();
    return apiRequest(`/api/jikan/anime${query ? '?' + query : ''}`);
  },

  async getRandomAnime() {
    return apiRequest(`/api/jikan/random/anime`);
  },

  async getAnimeCharacters(id) {
    return apiRequest(`/api/jikan/anime/${id}/characters`);
  },

  async getAnimeStaff(id) {
    return apiRequest(`/api/jikan/anime/${id}/staff`);
  },

  async getAnimePictures(id) {
    return apiRequest(`/api/jikan/anime/${id}/pictures`);
  },
};

// ─── TraceMoeService (番剧识别) ───
// 通过Worker代理调用trace.moe API
export const TraceMoeService = {
  async searchByUrl(imageUrl) {
    const query = new URLSearchParams({ url: imageUrl }).toString();
    return apiRequest(`/api/tracemoe/search?${query}`);
  },

  async searchByImage(imageFile) {
    const formData = new FormData();
    formData.append('image', imageFile);
    const res = await fetch(`${API_BASE}/api/tracemoe/search`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error('识别失败');
    return res.json();
  },

  async getMe() {
    return apiRequest(`/api/tracemoe/me`);
  },
};

// ─── KitsuService (动漫数据库) ───
// 通过Worker代理调用Kitsu API
export const KitsuService = {
  async getAnime(id) {
    return apiRequest(`/api/kitsu/anime/${id}`);
  },

  async getTrending(limit = 20) {
    return apiRequest(`/api/kitsu/anime?page[limit]=${limit}&sort=popularityRank`);
  },

  async getCurrent(limit = 20) {
    return apiRequest(`/api/kitsu/anime?page[limit]=${limit}&filter[status]=current&sort=startDate`);
  },

  async searchAnime(keyword, limit = 20) {
    return apiRequest(`/api/kitsu/anime?page[limit]=${limit}&filter[text]=${encodeURIComponent(keyword)}`);
  },

  async getAnimeCategories(id) {
    return apiRequest(`/api/kitsu/anime/${id}/categories`);
  },

  async getAnimeCharacters(id) {
    return apiRequest(`/api/kitsu/anime/${id}/characters`);
  },

  async getAnimeStaff(id) {
    return apiRequest(`/api/kitsu/anime/${id}/staff`);
  },

  async getAnimeProductions(id) {
    return apiRequest(`/api/kitsu/anime/${id}/productions`);
  },
};

// ─── ProfileService ───
// 用户画像获取与刷新
export const ProfileService = {
  async getProfile() {
    return apiRequest('/api/profile');
  },

  async refreshProfile() {
    return apiRequest('/api/profile/refresh', {
      method: 'POST',
    });
  },
};

// ─── BehaviorService ───
// 用户行为上报
export const BehaviorService = {
  async report(action, targetType = '', targetId = 0, metadata = {}) {
    return apiRequest('/api/behavior', {
      method: 'POST',
      body: JSON.stringify({
        action,
        target_type: targetType,
        target_id: targetId,
        metadata,
      }),
    });
  },
};

// ─── RecommendService ───
// 推荐结果获取
export const RecommendService = {
  async getRecommend(scene = 'home_random') {
    return apiRequest(`/api/recommend?scene=${scene}`);
  },
};

// ─── ExploreService ───
// 探索流
export const ExploreService = {
  async getFeed(category = '', page = 1) {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    params.set('page', page);
    return apiRequest(`/api/explore?${params.toString()}`);
  },
};

// ─── PromotionService ───
// 推广位
export const PromotionService = {
  async getPromotions(slot = 'home') {
    return apiRequest(`/api/promotions?slot=${slot}`);
  },
};

// ─── SearchSuggestionService ───
// 搜索建议
export const SearchSuggestionService = {
  async getSuggestions(query) {
    if (!query || query.length < 2) return { suggestions: [] };
    return apiRequest(`/api/search/suggestions?q=${encodeURIComponent(query)}`);
  },
};

// ─── ShortProfileService ───
// 短期画像
export const ShortProfileService = {
  async getShortProfile() {
    return apiRequest('/api/profile/short');
  },
};

// ─── CreativeSpaceService ───
// 创作空间笔记，走后端 API（需认证）
export const CreativeSpaceService = {
  async list() {
    return apiRequest('/api/creative-notes');
  },

  async create(data) {
    return apiRequest('/api/creative-notes', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async get(id) {
    return apiRequest(`/api/creative-notes/${id}`);
  },

  async update(id, data) {
    return apiRequest(`/api/creative-notes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async remove(id) {
    return apiRequest(`/api/creative-notes/${id}`, {
      method: 'DELETE',
    });
  },

  async getTimeline() {
    return apiRequest('/api/creative-notes/timeline');
  },
};

// ─── SuperService ───
// 超展开（Bangumi 小组）API，走后端代理
export { SuperService } from './SuperService.js';
