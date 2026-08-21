import { StorageService } from './storage';

const API_BASE = 'https://anispace-oauth-proxy.lyw2373314970.workers.dev/api';

// ─── 请求辅助函数，自动附加 Authorization header ───
async function apiFetch(path, options = {}) {
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

// ─── 武藏也创作者平台 Service ───
export const MusashiService = {

  // ── 作品 CRUD ──

  async getWorks({ type, sort, page, limit, search } = {}) {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (sort) params.set('sort', sort);
    if (page) params.set('page', page);
    if (limit) params.set('limit', limit);
    if (search) params.set('search', search);
    const qs = params.toString();
    return apiFetch(`/works${qs ? `?${qs}` : ''}`);
  },

  async getWork(id) {
    return apiFetch(`/works/${id}`);
  },

  async createWork(data) {
    return apiFetch('/works', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateWork(id, data) {
    return apiFetch(`/works/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteWork(id) {
    return apiFetch(`/works/${id}`, {
      method: 'DELETE',
    });
  },

  async getMyWorks() {
    return apiFetch('/works/my');
  },

  // ── 互动 ──

  async toggleLike(id) {
    return apiFetch(`/works/${id}/like`, {
      method: 'POST',
    });
  },

  async toggleFavorite(id) {
    return apiFetch(`/works/${id}/favorite`, {
      method: 'POST',
    });
  },

  async recordView(id) {
    return apiFetch(`/works/${id}/view`, {
      method: 'POST',
    });
  },

  async getComments(id) {
    return apiFetch(`/works/${id}/comments`);
  },

  async addComment(id, content) {
    return apiFetch(`/works/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  },

  async reportWork(id, reason) {
    return apiFetch(`/works/${id}/report`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  // ── 小说章节 ──

  async getChapters(workId) {
    return apiFetch(`/works/${workId}/chapters`);
  },

  async getChapter(workId, chapterId) {
    return apiFetch(`/works/${workId}/chapters/${chapterId}`);
  },

  async addChapter(workId, data) {
    return apiFetch(`/works/${workId}/chapters`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateChapter(workId, chapterId, data) {
    return apiFetch(`/works/${workId}/chapters/${chapterId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteChapter(workId, chapterId) {
    return apiFetch(`/works/${workId}/chapters/${chapterId}`, {
      method: 'DELETE',
    });
  },

  async reorderChapters(workId, order) {
    return apiFetch(`/works/${workId}/chapters/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ order }),
    });
  },

  // ── 漫画画数 ──

  async getMangaChapters(workId) {
    return apiFetch(`/works/${workId}/manga-chapters`);
  },

  async addMangaChapter(workId, data) {
    return apiFetch(`/works/${workId}/manga-chapters`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async deleteMangaChapter(workId, chapterId) {
    return apiFetch(`/works/${workId}/manga-chapters/${chapterId}`, {
      method: 'DELETE',
    });
  },

  async addMangaPage(workId, chapterId, data) {
    return apiFetch(`/works/${workId}/manga-chapters/${chapterId}/pages`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async deleteMangaPage(workId, pageId) {
    return apiFetch(`/works/${workId}/manga-pages/${pageId}`, {
      method: 'DELETE',
    });
  },

  // ── Galgame ──

  async addDownload(workId, data) {
    return apiFetch(`/works/${workId}/downloads`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateDownload(workId, downloadId, data) {
    return apiFetch(`/works/${workId}/downloads/${downloadId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteDownload(workId, downloadId) {
    return apiFetch(`/works/${workId}/downloads/${downloadId}`, {
      method: 'DELETE',
    });
  },

  async addPreview(workId, data) {
    return apiFetch(`/works/${workId}/previews`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async deletePreview(workId, previewId) {
    return apiFetch(`/works/${workId}/previews/${previewId}`, {
      method: 'DELETE',
    });
  },

  // ── 阅读进度 ──

  async getAllProgress() {
    return apiFetch('/reading-progress');
  },

  async getProgress(workId) {
    return apiFetch(`/reading-progress/${workId}`);
  },

  async updateProgress(workId, data) {
    return apiFetch(`/reading-progress/${workId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  // ── 评分 ──

  async getRating(workId) {
    return apiFetch(`/works/${workId}/rating`);
  },

  async rateWork(workId, rating, dimensionScores = null) {
    const body = { rating };
    if (dimensionScores) body.dimension_scores = dimensionScores;
    return apiFetch(`/works/${workId}/rating`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async deleteRating(workId) {
    return apiFetch(`/works/${workId}/rating`, {
      method: 'DELETE',
    });
  },

  // ── 插画图片管理 ──

  async addIllustrations(workId, images) {
    return apiFetch(`/works/${workId}/illustrations`, {
      method: 'POST',
      body: JSON.stringify({ images }),
    });
  },

  async deleteIllustration(workId, imageId) {
    return apiFetch(`/works/${workId}/illustrations/${imageId}`, {
      method: 'DELETE',
    });
  },

  async reorderIllustrations(workId, order) {
    return apiFetch(`/works/${workId}/illustrations/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ order }),
    });
  },

  // ── 排行榜 ──

  async getRankings({ type = 'daily', category = 'all', limit = 20 } = {}) {
    const params = new URLSearchParams({ type, category, limit });
    return apiFetch(`/works/rankings?${params}`);
  },

  // ── 创作者主页 ──

  async getPortfolio(userId) {
    return apiFetch(`/users/${userId}/portfolio`);
  },

  // ── 关注动态流 ──

  async getFeed({ page = 1, limit = 20 } = {}) {
    const params = new URLSearchParams({ page, limit });
    return apiFetch(`/feed?${params}`);
  },

  // ── 系列 ──

  async createSeries(data) {
    return apiFetch('/series', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getSeries(id) {
    return apiFetch(`/series/${id}`);
  },

  async updateSeries(id, data) {
    return apiFetch(`/series/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteSeries(id) {
    return apiFetch(`/series/${id}`, {
      method: 'DELETE',
    });
  },

  async addWorkToSeries(seriesId, workId) {
    return apiFetch(`/series/${seriesId}/works`, {
      method: 'POST',
      body: JSON.stringify({ work_id: workId }),
    });
  },

  async removeWorkFromSeries(seriesId, workId) {
    return apiFetch(`/series/${seriesId}/works/${workId}`, {
      method: 'DELETE',
    });
  },

  // ── 约稿企划 ──

  async getCommissions({ page = 1, limit = 20, category = '', status = 'open' } = {}) {
    const params = new URLSearchParams({ page, limit, status });
    if (category) params.set('category', category);
    return apiFetch(`/commissions?${params}`);
  },

  async getCommission(id) {
    return apiFetch(`/commissions/${id}`);
  },

  async createCommission(data) {
    return apiFetch('/commissions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateCommission(id, data) {
    return apiFetch(`/commissions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteCommission(id) {
    return apiFetch(`/commissions/${id}`, {
      method: 'DELETE',
    });
  },

  async respondCommission(id, data) {
    return apiFetch(`/commissions/${id}/respond`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // ── 作品讨论区 ──

  async getWorkDiscussions(workId, { page = 1, limit = 20 } = {}) {
    const params = new URLSearchParams({ page, limit });
    return apiFetch(`/works/${workId}/discussions?${params}`);
  },

  // ── 读者感想 ──

  async getWorkImpressions(workId, { page = 1, limit = 20 } = {}) {
    const params = new URLSearchParams({ page, limit });
    return apiFetch(`/works/${workId}/impressions?${params}`);
  },

  async submitImpression(workId, data) {
    return apiFetch(`/works/${workId}/impressions`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

export default MusashiService;
