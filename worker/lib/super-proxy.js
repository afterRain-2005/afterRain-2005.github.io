/**
 * ANISpace 超展开代理模块
 * 功能：代理 Bangumi 小组 API，实现小组浏览、发帖、成员管理等功能
 */

// Bangumi Private API 基础 URL
// 私有 API 端点位于 next.bgm.tv/p1/ 前缀下
const BANGUMI_PRIVATE_API = 'https://next.bgm.tv';

/**
 * 获取用户的 Bangumi access token
 * @param {object} db - D1 数据库绑定
 * @param {number} userId - 用户 ID
 * @returns {object|null} token 信息或 null
 */
export async function getBangumiToken(db, userId) {
  const user = await db.prepare(
    'SELECT bangumi_access_token, bangumi_refresh_token, bangumi_token_expires_at, bangumi_user_id, bangumi_username, bangumi_avatar, bangumi_bound_at FROM users WHERE id = ?'
  ).bind(userId).first();

  if (!user || !user.bangumi_access_token) {
    return null;
  }

  // 检查 token 是否过期
  const now = Math.floor(Date.now() / 1000);
  if (user.bangumi_token_expires_at && user.bangumi_token_expires_at < now) {
    // Token 已过期，返回 null（需要刷新）
    return { expired: true, refreshToken: user.bangumi_refresh_token };
  }

  return {
    accessToken: user.bangumi_access_token,
    refreshToken: user.bangumi_refresh_token,
    expiresAt: user.bangumi_token_expires_at,
    bangumiUserId: user.bangumi_user_id,
    bangumiUsername: user.bangumi_username,
    bangumiAvatar: user.bangumi_avatar,
    boundAt: user.bangumi_bound_at,
  };
}

/**
 * 代理 Bangumi Private API 请求
 * @param {string} endpoint - API 端点（如 /p/groups）
 * @param {string} accessToken - Bangumi access token
 * @param {object} options - 请求选项（method, body, params）
 * @returns {object} API 响应
 */
export async function proxyBangumiAPI(endpoint, accessToken, options = {}) {
  const { method = 'GET', body = null, params = {} } = options;

  // 构建完整 URL
  const url = new URL(`${BANGUMI_PRIVATE_API}${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.append(key, value);
  }

  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Accept': 'application/json',
    'User-Agent': 'ANISpace-SuperProxy/1.0',
  };

  if (body && (method === 'POST' || method === 'PUT')) {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const res = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : null,
    });

    const data = await res.json();

    if (!res.ok) {
      return { error: data.error || data.message || 'Bangumi API 请求失败', status: res.status };
    }

    return { data, status: res.status };
  } catch (err) {
    return { error: `Bangumi API 请求异常: ${err.message}`, status: 500 };
  }
}

/**
 * 获取最新小组话题列表（超展开首页）
 * GET /api/super/topics/latest
 * 使用 Bangumi p1 API: p1/groups/-/topics?mode=all
 * @param {object} db - D1 数据库
 * @param {number} userId - 用户 ID
 * @param {object} params - 查询参数（limit, offset, mode）
 * @returns {object} 话题列表
 */
export async function handleLatestTopics(db, userId, params = {}) {
  const tokenInfo = await getBangumiToken(db, userId);
  if (!tokenInfo) {
    return { error: '请先绑定 Bangumi 账号', status: 401 };
  }
  if (tokenInfo.expired) {
    return { error: 'Bangumi token 已过期，请重新绑定', status: 401 };
  }

  const { limit = 20, offset = 0, mode = 'all' } = params;
  const result = await proxyBangumiAPI('/p1/groups/-/topics', tokenInfo.accessToken, {
    params: { limit, offset, mode },
  });
  if (result.error) return result;

  // 映射为前端期望的格式
  const topics = (result.data?.data || []).map(t => ({
    id: t.id,
    title: t.title || '',
    author: t.creator?.nickname || t.creator?.username || '匿名',
    author_avatar: t.creator?.avatar?.medium || t.creator?.avatar?.small || '',
    replies: t.replyCount || 0,
    created_at: t.createdAt ? new Date(t.createdAt * 1000).toISOString() : '',
    updated_at: t.updatedAt ? new Date(t.updatedAt * 1000).toISOString() : '',
    group: t.group ? {
      id: t.group.id,
      name: t.group.name,
      title: t.group.title,
      icon: t.group.icon?.medium || t.group.icon?.small || '',
    } : null,
  }));

  return { data: { data: topics, total: result.data?.total || 0 }, status: 200 };
}

/**
 * 处理小组列表请求
 * GET /api/super/groups
 * @param {object} db - D1 数据库
 * @param {object} env - Worker 环境变量
 * @param {number} userId - 用户 ID
 * @param {object} params - 查询参数（page, limit, sort, cat）
 * @returns {object} 小组列表
 */
export async function handleGroupsList(db, env, userId, params = {}) {
  const tokenInfo = await getBangumiToken(db, userId);
  if (!tokenInfo) {
    return { error: '请先绑定 Bangumi 账号', status: 401 };
  }
  if (tokenInfo.expired) {
    return { error: 'Bangumi token 已过期，请重新绑定', status: 401 };
  }

  const { page = 1, limit = 20, sort = 'members', cat } = params;
  const offset = (page - 1) * limit;
  const queryParams = { limit, offset, sort };
  if (cat) queryParams.cat = cat;

  const result = await proxyBangumiAPI('/p1/groups', tokenInfo.accessToken, { params: queryParams });
  if (result.error) return result;

  // 映射为前端期望的格式
  const groups = (result.data?.data || []).map(g => ({
    id: g.id,
    name: g.name,
    title: g.title,
    icon: g.icon?.medium || g.icon?.small || '',
    members: g.members || 0,
    topics: g.topics || 0,
    posts: g.posts || 0,
    nsfw: g.nsfw || false,
    desc: g.description || '',
  }));

  return { data: { data: groups, total: result.data?.total || 0 }, status: 200 };
}

/**
 * 处理小组详情请求
 * GET /api/super/groups/:groupName
 * @param {object} db - D1 数据库
 * @param {object} env - Worker 环境变量
 * @param {number} userId - 用户 ID
 * @param {string} groupName - 小组名称（英文标识）
 * @returns {object} 小组详情
 */
export async function handleGroupDetail(db, env, userId, groupName) {
  const tokenInfo = await getBangumiToken(db, userId);
  if (!tokenInfo) {
    return { error: '请先绑定 Bangumi 账号', status: 401 };
  }
  if (tokenInfo.expired) {
    return { error: 'Bangumi token 已过期，请重新绑定', status: 401 };
  }

  const result = await proxyBangumiAPI(`/p1/groups/${groupName}`, tokenInfo.accessToken);
  if (result.error) return result;

  const g = result.data;
  // 映射为前端期望的格式
  return {
    data: {
      id: g.id,
      name: g.name,
      title: g.title,
      icon: g.icon?.medium || g.icon?.small || '',
      desc: g.description || '',
      members: g.members || 0,
      topics: g.topics || 0,
      posts: g.posts || 0,
      nsfw: g.nsfw || false,
    },
    status: 200,
  };
}

/**
 * 处理话题列表请求
 * GET /api/super/groups/:groupName/topics
 * @param {object} db - D1 数据库
 * @param {object} env - Worker 环境变量
 * @param {number} userId - 用户 ID
 * @param {string} groupName - 小组名称（英文标识）
 * @param {object} params - 查询参数（page, limit）
 * @returns {object} 话题列表
 */
export async function handleTopicsList(db, env, userId, groupName, params = {}) {
  const tokenInfo = await getBangumiToken(db, userId);
  if (!tokenInfo) {
    return { error: '请先绑定 Bangumi 账号', status: 401 };
  }
  if (tokenInfo.expired) {
    return { error: 'Bangumi token 已过期，请重新绑定', status: 401 };
  }

  const { limit = 20, offset = 0 } = params;
  const result = await proxyBangumiAPI(`/p1/groups/${groupName}/topics`, tokenInfo.accessToken, { params: { limit, offset } });
  if (result.error) return result;

  // 映射为前端期望的格式
  const topics = (result.data?.data || []).map(t => ({
    id: t.id,
    title: t.title || '',
    author: t.creator?.nickname || t.creator?.username || '匿名',
    author_avatar: t.creator?.avatar?.medium || t.creator?.avatar?.small || '',
    replies: t.replyCount || 0,
    created_at: t.createdAt ? new Date(t.createdAt * 1000).toISOString() : '',
    updated_at: t.updatedAt ? new Date(t.updatedAt * 1000).toISOString() : '',
  }));

  return { data: { data: topics, total: result.data?.total || 0 }, status: 200 };
}

/**
 * 处理话题详情请求
 * GET /api/super/topics/:id
 * 使用 Bangumi p1 API: p1/groups/-/topics/{topicId}
 * @param {object} db - D1 数据库
 * @param {object} env - Worker 环境变量
 * @param {number} userId - 用户 ID
 * @param {number} topicId - 话题 ID
 * @returns {object} 话题详情（包含帖子列表）
 */
export async function handleTopicDetail(db, env, userId, topicId) {
  const tokenInfo = await getBangumiToken(db, userId);
  if (!tokenInfo) {
    return { error: '请先绑定 Bangumi 账号', status: 401 };
  }
  if (tokenInfo.expired) {
    return { error: 'Bangumi token 已过期，请重新绑定', status: 401 };
  }

  const result = await proxyBangumiAPI(`/p1/groups/-/topics/${topicId}`, tokenInfo.accessToken);
  if (result.error) return result;

  const topic = result.data;
  // 映射为前端期望的格式
  return {
    id: topic.id,
    title: topic.title || '',
    author: topic.creator?.nickname || topic.creator?.username || '匿名',
    author_avatar: topic.creator?.avatar?.medium || topic.creator?.avatar?.small || '',
    created_at: topic.createdAt ? new Date(topic.createdAt * 1000).toISOString() : '',
    updated_at: topic.updatedAt ? new Date(topic.updatedAt * 1000).toISOString() : '',
    reply_count: topic.replyCount || 0,
    group: topic.group ? {
      id: topic.group.id,
      name: topic.group.name,
      title: topic.group.title,
      icon: topic.group.icon?.medium || topic.group.icon?.small || '',
    } : null,
  };
}

/**
 * 处理帖子列表请求
 * GET /api/super/topics/:id/posts
 * 从话题详情的 replies 字段获取帖子列表
 * @param {object} db - D1 数据库
 * @param {object} env - Worker 环境变量
 * @param {number} userId - 用户 ID
 * @param {number} topicId - 话题 ID
 * @param {object} params - 查询参数（page, limit）
 * @returns {object} 帖子列表
 */
export async function handlePostsList(db, env, userId, topicId, params = {}) {
  const tokenInfo = await getBangumiToken(db, userId);
  if (!tokenInfo) {
    return { error: '请先绑定 Bangumi 账号', status: 401 };
  }
  if (tokenInfo.expired) {
    return { error: 'Bangumi token 已过期，请重新绑定', status: 401 };
  }

  // 调用 p1 API 获取话题详情（含 replies）
  const result = await proxyBangumiAPI(`/p1/groups/-/topics/${topicId}`, tokenInfo.accessToken);
  if (result.error) return result;

  const topic = result.data;
  const replies = topic.replies || [];

  // 映射为前端期望的格式
  const posts = replies.map((reply, index) => ({
    id: reply.id,
    floor: index + 1,
    author: reply.creator?.nickname || reply.creator?.username || '匿名',
    author_avatar: reply.creator?.avatar?.medium || reply.creator?.avatar?.small || '',
    content: reply.content || '',
    created_at: reply.createdAt ? new Date(reply.createdAt * 1000).toISOString() : '',
    related: null,
  }));

  const { page = 1, limit = 50 } = params;
  const start = (page - 1) * limit;
  const end = start + limit;

  return {
    data: posts.slice(start, end),
    total: posts.length,
    page,
    limit,
  };
}

/**
 * 处理发表话题请求
 * POST /api/super/groups/:groupName/topics
 * @param {object} db - D1 数据库
 * @param {object} env - Worker 环境变量
 * @param {number} userId - 用户 ID
 * @param {string} groupName - 小组名称（英文标识）
 * @param {object} body - 话题内容（title, content）
 * @returns {object} 创建结果
 */
export async function handleCreateTopic(db, env, userId, groupName, body) {
  const tokenInfo = await getBangumiToken(db, userId);
  if (!tokenInfo) {
    return { error: '请先绑定 Bangumi 账号', status: 401 };
  }
  if (tokenInfo.expired) {
    return { error: 'Bangumi token 已过期，请重新绑定', status: 401 };
  }

  if (!body.title || !body.content) {
    return { error: '话题标题和内容不能为空', status: 400 };
  }

  return await proxyBangumiAPI(`/p1/groups/${groupName}/topics`, tokenInfo.accessToken, {
    method: 'POST',
    body: { title: body.title, content: body.content },
  });
}

/**
 * 处理发表回复请求
 * POST /api/super/topics/:id/posts
 * @param {object} db - D1 数据库
 * @param {object} env - Worker 环境变量
 * @param {number} userId - 用户 ID
 * @param {number} topicId - 话题 ID
 * @param {object} body - 回复内容（content, related）
 * @returns {object} 创建结果
 */
export async function handleCreatePost(db, env, userId, topicId, body) {
  const tokenInfo = await getBangumiToken(db, userId);
  if (!tokenInfo) {
    return { error: '请先绑定 Bangumi 账号', status: 401 };
  }
  if (tokenInfo.expired) {
    return { error: 'Bangumi token 已过期，请重新绑定', status: 401 };
  }

  if (!body.content) {
    return { error: '回复内容不能为空', status: 400 };
  }

  // Bangumi p1 API 要求 turnstileToken（Cloudflare Turnstile 人机验证令牌）
  if (!body.turnstileToken) {
    return { error: '缺少人机验证令牌，无法发表回复', status: 400 };
  }

  const postBody = { content: body.content, turnstileToken: body.turnstileToken };
  if (body.related) {
    postBody.related = body.related; // 关联帖子 ID（回复某楼层）
  }

  return await proxyBangumiAPI(`/p1/groups/-/topics/${topicId}/replies`, tokenInfo.accessToken, {
    method: 'POST',
    body: postBody,
  });
}

/**
 * 处理加入小组请求
 * POST /api/super/groups/:groupName/join
 * @param {object} db - D1 数据库
 * @param {object} env - Worker 环境变量
 * @param {number} userId - 用户 ID
 * @param {string} groupName - 小组名称（英文标识）
 * @returns {object} 加入结果
 */
export async function handleJoinGroup(db, env, userId, groupName) {
  const tokenInfo = await getBangumiToken(db, userId);
  if (!tokenInfo) {
    return { error: '请先绑定 Bangumi 账号', status: 401 };
  }
  if (tokenInfo.expired) {
    return { error: 'Bangumi token 已过期，请重新绑定', status: 401 };
  }

  return await proxyBangumiAPI(`/p1/groups/${groupName}/join`, tokenInfo.accessToken, {
    method: 'POST',
  });
}

/**
 * 处理退出小组请求
 * DELETE /api/super/groups/:groupName/leave
 * @param {object} db - D1 数据库
 * @param {object} env - Worker 环境变量
 * @param {number} userId - 用户 ID
 * @param {string} groupName - 小组名称（英文标识）
 * @returns {object} 退出结果
 */
export async function handleLeaveGroup(db, env, userId, groupName) {
  const tokenInfo = await getBangumiToken(db, userId);
  if (!tokenInfo) {
    return { error: '请先绑定 Bangumi 账号', status: 401 };
  }
  if (tokenInfo.expired) {
    return { error: 'Bangumi token 已过期，请重新绑定', status: 401 };
  }

  return await proxyBangumiAPI(`/p1/groups/${groupName}/leave`, tokenInfo.accessToken, {
    method: 'POST',
  });
}

/**
 * 处理创建小组请求
 * POST /api/super/groups
 * @param {object} db - D1 数据库
 * @param {object} env - Worker 环境变量
 * @param {number} userId - 用户 ID
 * @param {object} body - 小组信息（name, title, desc, icon, nsfw, accessible）
 * @returns {object} 创建结果
 */
export async function handleCreateGroup(db, env, userId, body) {
  const tokenInfo = await getBangumiToken(db, userId);
  if (!tokenInfo) {
    return { error: '请先绑定 Bangumi 账号', status: 401 };
  }
  if (tokenInfo.expired) {
    return { error: 'Bangumi token 已过期，请重新绑定', status: 401 };
  }

  if (!body.name || !body.title) {
    return { error: '小组名称和标题不能为空', status: 400 };
  }

  const groupBody = {
    name: body.name,
    title: body.title,
    desc: body.desc || '',
    icon: body.icon || '',
    nsfw: body.nsfw || false,
    accessible: body.accessible !== false, // 默认公开
  };

  return await proxyBangumiAPI('/p1/groups', tokenInfo.accessToken, {
    method: 'POST',
    body: groupBody,
  });
}

/**
 * 处理 Bangumi 账号绑定状态查询
 * GET /api/auth/bangumi-status
 * @param {object} db - D1 数据库
 * @param {number} userId - 用户 ID
 * @returns {object} 绑定状态
 */
export async function handleBangumiStatus(db, userId) {
  const tokenInfo = await getBangumiToken(db, userId);

  if (!tokenInfo) {
    return {
      bound: false,
      message: '未绑定 Bangumi 账号',
    };
  }

  if (tokenInfo.expired) {
    return {
      bound: true,
      expired: true,
      message: 'Bangumi token 已过期，请重新绑定',
    };
  }

  return {
    bound: true,
    expired: false,
    bangumiUserId: tokenInfo.bangumiUserId,
    bangumiUsername: tokenInfo.bangumiUsername,
    bangumiAvatar: tokenInfo.bangumiAvatar,
    boundAt: tokenInfo.boundAt,
    expiresAt: tokenInfo.expiresAt,
  };
}

/**
 * 绑定 Bangumi 账号（保存 token 到用户表）
 * POST /api/auth/bind-bangumi
 * @param {object} db - D1 数据库
 * @param {number} userId - 用户 ID
 * @param {object} tokenData - Bangumi token 数据
 * @returns {object} 绑定结果
 */
export async function handleBindBangumi(db, userId, tokenData) {
  // 兼容驼峰和下划线两种字段命名
  const accessToken = tokenData.accessToken || tokenData.access_token;
  if (!accessToken) {
    return { error: '缺少 access_token', status: 400 };
  }

  const now = Math.floor(Date.now() / 1000);
  // 前端可能传 expiresAt（已计算好的时间戳）或 expires_in（秒数）
  const expiresAt = tokenData.expiresAt
    ? Math.floor(tokenData.expiresAt / 1000)
    : (tokenData.expires_in ? now + tokenData.expires_in : null);

  try {
    await db.prepare(
      `UPDATE users SET
        bangumi_access_token = ?,
        bangumi_refresh_token = ?,
        bangumi_token_expires_at = ?,
        bangumi_user_id = ?,
        bangumi_username = ?,
        bangumi_avatar = ?,
        bangumi_bound_at = ?
      WHERE id = ?`
    ).bind(
      accessToken,
      tokenData.refreshToken || tokenData.refresh_token || null,
      expiresAt,
      tokenData.bangumiUserId || tokenData.user_id || null,
      tokenData.bangumiUsername || tokenData.username || null,
      tokenData.bangumiAvatar || tokenData.avatar || null,
      now,
      userId
    ).run();

    return {
      success: true,
      message: 'Bangumi 账号绑定成功',
      bangumiUserId: tokenData.bangumiUserId || tokenData.user_id,
      bangumiUsername: tokenData.bangumiUsername || tokenData.username,
    };
  } catch (err) {
    return { error: `绑定失败: ${err.message}`, status: 500 };
  }
}

/**
 * 解绑 Bangumi 账号
 * DELETE /api/auth/unbind-bangumi
 * @param {object} db - D1 数据库
 * @param {number} userId - 用户 ID
 * @returns {object} 解绑结果
 */
export async function handleUnbindBangumi(db, userId) {
  try {
    await db.prepare(
      `UPDATE users SET
        bangumi_access_token = NULL,
        bangumi_refresh_token = NULL,
        bangumi_token_expires_at = NULL,
        bangumi_user_id = NULL,
        bangumi_username = NULL,
        bangumi_avatar = NULL,
        bangumi_bound_at = NULL
      WHERE id = ?`
    ).bind(userId).run();

    return { success: true, message: 'Bangumi 账号已解绑' };
  } catch (err) {
    return { error: `解绑失败: ${err.message}`, status: 500 };
  }
}

/**
 * 获取条目吐槽（短评）列表
 * GET /api/bangumi/subjects/:id/comments
 * @param {object} env - Worker 环境变量
 * @param {number} subjectId - 条目 ID
 * @param {object} params - 查询参数（limit, offset）
 * @returns {object} 吐槽列表
 */
export async function handleSubjectComments(env, subjectId, params = {}) {
  const { limit = 20, offset = 0 } = params;
  const cacheKey = `bgm_comments_${subjectId}_${offset}_${limit}`;

  // 尝试从 Cache API 读取
  const cache = caches.default;
  const cachedResponse = await cache.match(new Request(`https://cache.local/${cacheKey}`));
  if (cachedResponse) {
    const cachedData = await cachedResponse.json();
    if (Date.now() - cachedData.cachedAt < 1800000) {
      return { data: cachedData.data, total: cachedData.total, cached: true };
    }
  }

  // 调用 Bangumi 私有 API（无需认证）
  const url = new URL(`${BANGUMI_PRIVATE_API}/p1/subjects/${subjectId}/comments`);
  url.searchParams.set('limit', limit);
  url.searchParams.set('offset', offset);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'ANISpace-SuperProxy/1.0',
      },
    });

    if (!res.ok) {
      return { error: `Bangumi API 返回 ${res.status}`, status: res.status };
    }

    const data = await res.json();

    // 写入 Cache API
    const cacheData = { ...data, cachedAt: Date.now() };
    const responseToCache = new Response(JSON.stringify(cacheData), {
      headers: { 'Content-Type': 'application/json' },
    });
    await cache.put(new Request(`https://cache.local/${cacheKey}`), responseToCache);

    return { data: data.data, total: data.total, cached: false };
  } catch (err) {
    return { error: `Bangumi API 请求异常: ${err.message}`, status: 500 };
  }
}

/**
 * 获取条目长评（评论）列表
 * GET /api/bangumi/subjects/:id/reviews
 * @param {object} env - Worker 环境变量
 * @param {number} subjectId - 条目 ID
 * @param {object} params - 查询参数（limit, offset）
 * @returns {object} 长评列表
 */
export async function handleSubjectReviews(env, subjectId, params = {}) {
  const { limit = 10, offset = 0 } = params;
  const cacheKey = `bgm_reviews_${subjectId}_${offset}_${limit}`;

  // 尝试从 Cache API 读取
  const cache = caches.default;
  const cachedResponse = await cache.match(new Request(`https://cache.local/${cacheKey}`));
  if (cachedResponse) {
    const cachedData = await cachedResponse.json();
    if (Date.now() - cachedData.cachedAt < 1800000) {
      return { data: cachedData.data, total: cachedData.total, cached: true };
    }
  }

  // 调用 Bangumi 私有 API（无需认证）
  const url = new URL(`${BANGUMI_PRIVATE_API}/p1/subjects/${subjectId}/reviews`);
  url.searchParams.set('limit', limit);
  url.searchParams.set('offset', offset);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'ANISpace-SuperProxy/1.0',
      },
    });

    if (!res.ok) {
      return { error: `Bangumi API 返回 ${res.status}`, status: res.status };
    }

    const data = await res.json();

    // 写入 Cache API
    const cacheData = { ...data, cachedAt: Date.now() };
    const responseToCache = new Response(JSON.stringify(cacheData), {
      headers: { 'Content-Type': 'application/json' },
    });
    await cache.put(new Request(`https://cache.local/${cacheKey}`), responseToCache);

    return { data: data.data, total: data.total, cached: false };
  } catch (err) {
    return { error: `Bangumi API 请求异常: ${err.message}`, status: 500 };
  }
}

/**
 * 获取当前用户在 Bangumi 上对某条目的收藏状态（含评分）
 * GET /api/bangumi/collection/:subjectId
 * @param {object} db - D1 数据库
 * @param {number} userId - 用户 ID
 * @param {number} subjectId - 条目 ID
 * @returns {object} 收藏状态（含 rate 评分）
 */
export async function handleUserCollection(db, userId, subjectId) {
  const tokenInfo = await getBangumiToken(db, userId);
  if (!tokenInfo) {
    return { error: '未绑定 Bangumi 账号', status: 401 };
  }
  if (tokenInfo.expired) {
    return { error: 'Bangumi token 已过期，请重新绑定', status: 401 };
  }

  // 调用 Bangumi v0 API 获取用户收藏状态
  const url = `https://api.bgm.tv/v0/users/${tokenInfo.bangumiUsername}/collections/${subjectId}`;

  try {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${tokenInfo.accessToken}`,
        'Accept': 'application/json',
        'User-Agent': 'ANISpace-SuperProxy/1.0',
      },
    });

    if (res.status === 404) {
      return { data: null, rate: 0, type: 0 };
    }

    if (!res.ok) {
      return { error: `Bangumi API 返回 ${res.status}`, status: res.status };
    }

    const data = await res.json();
    return {
      data: data,
      rate: data.rate || 0,
      type: data.type || 0,
      comment: data.comment || '',
    };
  } catch (err) {
    return { error: `Bangumi API 请求异常: ${err.message}`, status: 500 };
  }
}