// src/services/SuperService.js
// 超展开（Bangumi 小组）API 服务

import { apiRequest } from './api.js';

/**
 * SuperService - Bangumi 小组超展开 API 封装
 * 所有请求通过 Worker 代理转发到 Bangumi Private API
 */
export const SuperService = {
  /**
   * 获取最新小组话题列表（超展开首页）
   * @param {number} page - 页码
   * @param {number} limit - 每页数量
   * @param {string} mode - 过滤模式 (all|joined|created|replied)
   * @returns {Promise<{data: Array, total: number}>}
   */
  async getLatestTopics(page = 1, limit = 20, mode = 'all') {
    const offset = (page - 1) * limit;
    const params = new URLSearchParams({ limit, offset, mode });
    return apiRequest(`/api/super/topics/latest?${params.toString()}`);
  },

  /**
   * 获取小组列表
   * @param {number} page - 页码
   * @param {number} limit - 每页数量
   * @param {string} sort - 排序方式 (members|topics|posts|latest)
   * @returns {Promise<{groups: Array, total: number, page: number, limit: number}>}
   */
  async getGroups(page = 1, limit = 20, sort = 'members') {
    const params = new URLSearchParams({ page, limit, sort });
    return apiRequest(`/api/super/groups?${params.toString()}`);
  },

  /**
   * 获取小组详情
   * @param {number} groupId - 小组 ID
   * @returns {Promise<Object>} 小组详情对象
   */
  async getGroupDetail(groupId) {
    return apiRequest(`/api/super/groups/${groupId}`);
  },

  /**
   * 获取小组话题列表
   * @param {number} groupId - 小组 ID
   * @param {number} page - 页码
   * @param {number} limit - 每页数量
   * @returns {Promise<{topics: Array, total: number, page: number, limit: number}>}
   */
  async getGroupTopics(groupId, page = 1, limit = 20) {
    const params = new URLSearchParams({ page, limit });
    return apiRequest(`/api/super/groups/${groupId}/topics?${params.toString()}`);
  },

  /**
   * 获取话题详情
   * @param {number} topicId - 话题 ID
   * @returns {Promise<Object>} 话题详情对象
   */
  async getTopicDetail(topicId) {
    return apiRequest(`/api/super/topics/${topicId}`);
  },

  /**
   * 获取话题帖子/回复列表
   * @param {number} topicId - 话题 ID
   * @param {number} page - 页码
   * @param {number} limit - 每页数量
   * @returns {Promise<{posts: Array, total: number, page: number, limit: number}>}
   */
  async getTopicPosts(topicId, page = 1, limit = 50) {
    const params = new URLSearchParams({ page, limit });
    return apiRequest(`/api/super/topics/${topicId}/posts?${params.toString()}`);
  },

  /**
   * 发表话题
   * @param {number} groupId - 小组 ID
   * @param {string} title - 话题标题
   * @param {string} content - 话题内容
   * @returns {Promise<{id: number, success: boolean}>}
   */
  async createTopic(groupId, title, content) {
    return apiRequest(`/api/super/groups/${groupId}/topics`, {
      method: 'POST',
      body: JSON.stringify({ title, content }),
    });
  },

  /**
   * 发表回复
   * @param {number} topicId - 话题 ID
   * @param {string} content - 回复内容
   * @param {number} related - 关联帖子 ID（回复某楼层）
   * @param {string} turnstileToken - Cloudflare Turnstile 人机验证令牌
   * @returns {Promise<{id: number, success: boolean}>}
   */
  async createPost(topicId, content, related = null, turnstileToken = null) {
    const body = { content };
    if (related) body.related = related;
    if (turnstileToken) body.turnstileToken = turnstileToken;
    return apiRequest(`/api/super/topics/${topicId}/posts`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  /**
   * 加入小组
   * @param {number} groupId - 小组 ID
   * @returns {Promise<{success: boolean, role: number}>}
   */
  async joinGroup(groupId) {
    return apiRequest(`/api/super/groups/${groupId}/join`, {
      method: 'POST',
    });
  },

  /**
   * 退出小组
   * @param {number} groupId - 小组 ID
   * @returns {Promise<{success: boolean}>}
   */
  async leaveGroup(groupId) {
    return apiRequest(`/api/super/groups/${groupId}/leave`, {
      method: 'DELETE',
    });
  },

  /**
   * 创建小组
   * @param {string} name - 小组名称（英文标识）
   * @param {string} title - 小组标题（显示名）
   * @param {string} desc - 小组简介
   * @param {string} icon - 小组图标 URL
   * @param {boolean} accessible - 是否公开
   * @param {boolean} nsfw - 是否 NSFW
   * @returns {Promise<{id: number, success: boolean}>}
   */
  async createGroup(name, title, desc, icon = '', accessible = true, nsfw = false) {
    return apiRequest('/api/super/groups', {
      method: 'POST',
      body: JSON.stringify({ name, title, desc, icon, accessible, nsfw }),
    });
  },

  /**
   * 查询 Bangumi 绑定状态
   * @returns {Promise<{bound: boolean, bangumiUserId: number|null, bangumiUsername: string|null}>}
   */
  async getBangumiStatus() {
    return apiRequest('/api/auth/bangumi-status');
  },
};