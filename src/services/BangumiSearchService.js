/**
 * ANISpace — Bangumi 本地搜索服务（前端）
 *
 * 取代 BangumiService.searchSubjects 中"仅靠官方 v0 搜索"的部分
 * 数据来源：worker 端 `/api/bangumi-search/search`
 *
 * 设计：
 *   - 300ms debounce（防抖，组件内调用）
 *   - 命中后 5min 内同 q 不重复请求
 *   - 结果带 source（local / mixed / official），用于 UI 展示数据来源
 */

import { ApiError } from './api.js';

const API_BASE = import.meta.env.VITE_OAUTH_PROXY_URL || 'https://anispace-oauth-proxy.lyw2373314970.workers.dev';
const CACHE_TTL = 5 * 60 * 1000; // 5 min
const MAX_Q_LEN = 100;

const _cache = new Map(); // q|type -> { ts, data }

function cacheKey(q, type) {
  return `${q.trim().toLowerCase()}|${type || 0}`;
}

function fromCache(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    _cache.delete(key);
    return null;
  }
  return entry.data;
}

function toCache(key, data) {
  if (_cache.size > 50) {
    // 简单 LRU：删除最早插入
    const firstKey = _cache.keys().next().value;
    if (firstKey) _cache.delete(firstKey);
  }
  _cache.set(key, { ts: Date.now(), data });
}

export const BangumiSearchService = {
  /**
   * 本地索引搜
   * @param {string} q 关键词
   * @param {number} type 0=全 / 1=book / 2=anime / 3=music / 4=game / 6=real
   * @returns {Promise<{ source, count, items }>}
   */
  async search(q, type = 0) {
    const qClean = (q || '').trim();
    if (!qClean) return { source: 'local', count: 0, items: [] };
    if (qClean.length > MAX_Q_LEN) {
      throw new ApiError('关键词过长', 400, 'INVALID_DATA');
    }
    const key = cacheKey(qClean, type);
    const cached = fromCache(key);
    if (cached) return cached;

    const token = sessionStorage.getItem('acg_jwt_token');
    const res = await fetch(
      `${API_BASE}/api/bangumi-search/search?q=${encodeURIComponent(qClean)}&type=${type}`,
      {
        headers: {
          'Accept': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
      }
    );
    if (!res.ok) {
      const code = res.status === 429 ? 'RATE_LIMITED'
        : res.status === 404 ? 'NOT_FOUND'
        : res.status >= 500 ? 'SERVER_ERROR'
        : 'API_ERROR';
      throw new ApiError(`搜索失败 (${res.status})`, res.status, code);
    }
    const data = await res.json();
    toCache(key, data);
    return data;
  },

  /**
   * 条目详情
   * @param {number} id
   */
  async getDetail(id) {
    if (!id) throw new ApiError('缺少 id', 400, 'INVALID_DATA');
    const token = sessionStorage.getItem('acg_jwt_token');
    const res = await fetch(
      `${API_BASE}/api/bangumi-search/detail/${id}`,
      {
        headers: {
          'Accept': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
      }
    );
    if (!res.ok) {
      if (res.status === 404) throw new ApiError('条目不存在', 404, 'NOT_FOUND');
      throw new ApiError(`获取详情失败 (${res.status})`, res.status);
    }
    return res.json();
  },

  /**
   * 清空内存缓存
   */
  clearCache() {
    _cache.clear();
  },

  /**
   * 暴露给调试面板
   */
  _stats() {
    return { size: _cache.size, ttl: CACHE_TTL };
  },
};

export default BangumiSearchService;
