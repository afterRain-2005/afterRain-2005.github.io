import { resolveRoute } from '../../utils/siteMap';
import { typeToKey, extractPreview } from '../../utils/subjectType';

// ─── 工具注册表 ───

const toolRegistry = new Map();

/**
 * 注册一个工具
 * @param {string} name - 工具名
 * @param {object} schema - 工具描述（供 LLM 理解参数格式）
 * @param {function} handler - 执行函数 (params, context) => result
 */
export function registerTool(name, schema, handler) {
  toolRegistry.set(name, { schema, handler });
}

/** 获取所有工具的 schema 描述（供 system prompt 注入） */
export function getToolSchemas() {
  return Array.from(toolRegistry.entries()).map(([name, { schema }]) => ({
    name,
    ...schema,
  }));
}

/** 获取工具的文本描述（供 DIRECTIVE_GUIDE 使用） */
export function getToolGuideText() {
  const lines = [];
  for (const [name, { schema }] of toolRegistry) {
    const params = schema.parameters
      ? Object.entries(schema.parameters).map(([k, v]) => `${k}:${v.type}${v.required ? '(必填)' : '(可选)'}`).join(', ')
      : '无参数';
    lines.push(`- ${name}(${params}) // ${schema.description}`);
  }
  return lines.join('\n');
}

/**
 * 执行工具
 * @param {string} name - 工具名
 * @param {object} params - 工具参数
 * @param {object} context - 上下文 { BangumiService, CollectionMarkService, currentUser, navigate, ... }
 * @returns {object} 执行结果
 */
export async function executeTool(name, params, context) {
  const tool = toolRegistry.get(name);
  if (!tool) return { error: `未知工具: ${name}` };
  try {
    return await tool.handler(params, context);
  } catch (err) {
    return { error: err.message || '工具执行失败' };
  }
}

// ─── 注册所有工具 ───

// goto — 跳转页面
registerTool('goto', {
  description: '跳转到站内页面',
  parameters: {
    target: { type: 'string', description: '页面标识: home/forum/news/wiki/musashi/mail/friends/world/music/me', required: true },
  },
}, (params) => {
  const route = resolveRoute(params.target);
  if (!route) return { error: `未知页面: ${params.target}` };
  return { route, label: params.target };
});

// search — 搜索条目
registerTool('search', {
  description: '搜索番剧/游戏/音乐等条目',
  parameters: {
    query: { type: 'string', description: '搜索关键词', required: true },
    count: { type: 'number', description: '返回数量，默认4，最多8', required: false },
  },
}, async (params, { BangumiService }) => {
  const query = (params.query || '').trim();
  if (!query) return { items: [] };
  const count = Math.min(Math.max(Number(params.count) || 4, 1), 8);
  const data = await BangumiService.searchSubjects(query, 0, count, 0);
  const list = data?.list || [];
  return {
    items: list.slice(0, count).map(item => ({
      id: item.id,
      name: item.name || '',
      name_cn: item.name_cn || '',
      type: item.type,
      image: item.images?.common || item.images?.medium || item.images?.large || '',
      to: `/info/${typeToKey(item.type)}/${item.id}`,
      state: { preview: extractPreview(item) },
    })),
  };
});

// recommend — 推荐条目
registerTool('recommend', {
  description: '根据关键词推荐番剧/游戏/音乐等作品',
  parameters: {
    query: { type: 'string', description: '推荐方向关键词', required: true },
    count: { type: 'number', description: '返回数量，默认4，最多8', required: false },
  },
}, async (params, { BangumiService }) => {
  const query = (params.query || '').trim();
  if (!query) return { items: [] };
  const count = Math.min(Math.max(Number(params.count) || 4, 1), 8);
  const data = await BangumiService.searchSubjects(query, 0, count, 0);
  const list = data?.list || [];
  return {
    items: list.slice(0, count).map(item => ({
      id: item.id,
      name: item.name || '',
      name_cn: item.name_cn || '',
      type: item.type,
      image: item.images?.common || item.images?.medium || item.images?.large || '',
      to: `/info/${typeToKey(item.type)}/${item.id}`,
      state: { preview: extractPreview(item) },
    })),
  };
});

// get_schedule — 获取放送表
registerTool('get_schedule', {
  description: '获取指定日期的番剧放送表',
  parameters: {
    date: { type: 'string', description: '日期，格式 YYYY-MM-DD，不填则为今天', required: false },
  },
}, async (params, { BangumiService }) => {
  const calendarData = await BangumiService.getCalendar();
  if (!Array.isArray(calendarData)) return { items: [] };

  // 确定目标星期
  let targetDay;
  if (params.date) {
    const d = new Date(params.date);
    if (isNaN(d.getTime())) return { error: '日期格式无效' };
    targetDay = d.getDay();
  } else {
    targetDay = new Date().getDay();
  }

  const weekdayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const cnMap = ['日', '一', '二', '三', '四', '五', '六'];
  const todayKey = weekdayMap[targetDay];
  const todayData = calendarData.find(d =>
    d.weekday?.en === todayKey || d.weekday?.cn === cnMap[targetDay]
  );

  if (!todayData?.items) return { items: [], weekday: cnMap[targetDay] };

  return {
    weekday: cnMap[targetDay],
    items: todayData.items.map(item => ({
      id: item.id,
      name: item.name_cn || item.name,
      name_jp: item.name,
      score: item.rating?.score || 0,
      type: item.type,
    })),
  };
});

// get_subject — 获取条目详情
registerTool('get_subject', {
  description: '获取指定条目的详细信息',
  parameters: {
    id: { type: 'number', description: '条目 ID', required: true },
  },
}, async (params, { BangumiService }) => {
  const id = Number(params.id);
  if (!id) return { error: '缺少条目 ID' };
  const subject = await BangumiService.getSubject(id);
  if (!subject) return { error: '条目不存在' };
  return {
    id: subject.id,
    name: subject.name_cn || subject.name,
    name_jp: subject.name,
    type: subject.type,
    score: subject.rating?.score || 0,
    rating_count: subject.rating?.total || 0,
    summary: (subject.summary || '').slice(0, 200),
    tags: (subject.tags || []).slice(0, 10).map(t => typeof t === 'string' ? t : t.name),
    eps: subject.eps || subject.total_episodes || 0,
    air_date: subject.air_date || '',
  };
});

// get_collections — 获取用户收藏列表
registerTool('get_collections', {
  description: '获取用户的收藏列表',
  parameters: {
    status: { type: 'string', description: '收藏状态: wish/collect/doing/on_hold/dropped，不填则返回全部', required: false },
  },
}, async (params, { CollectionMarkService, currentUser }) => {
  if (!currentUser?.id) return { error: '请先登录' };
  const collections = await CollectionMarkService.getByUserId(currentUser.id);
  if (!Array.isArray(collections)) return { items: [] };
  const filtered = params.status
    ? collections.filter(c => c.status === params.status)
    : collections;
  return {
    total: filtered.length,
    items: filtered.slice(0, 20).map(c => ({
      subject_id: c.subject_id,
      name: c.subject_name || '',
      status: c.status,
      rating: c.rating || null,
    })),
  };
});

// check_notify — 查看未读通知
registerTool('check_notify', {
  description: '查看用户的未读通知',
  parameters: {},
}, async (params, { NotificationService, currentUser }) => {
  if (!currentUser?.id) return { error: '请先登录' };
  const notifs = await NotificationService.getByUserId(currentUser.id);
  if (!Array.isArray(notifs)) return { items: [] };
  const unread = notifs.filter(n => !n.read).slice(0, 10);
  return {
    total_unread: notifs.filter(n => !n.read).length,
    items: unread.map(n => ({
      type: n.type,
      title: n.title || '',
      content: (n.content || '').slice(0, 100),
      link: n.link || '',
      created_at: n.created_at || '',
    })),
  };
});

// collect — 收藏/取消收藏条目
registerTool('collect', {
  description: '标记或修改条目收藏状态',
  parameters: {
    subject_id: { type: 'number', description: '条目 ID', required: true },
    status: { type: 'string', description: '收藏状态: wish/collect/doing/on_hold/dropped', required: true },
  },
}, async (params, { CollectionMarkService, currentUser }) => {
  if (!currentUser?.id) return { error: '请先登录' };
  const { subject_id, status } = params;
  if (!subject_id || !status) return { error: '缺少参数' };
  const validStatuses = ['wish', 'collect', 'doing', 'on_hold', 'dropped'];
  if (!validStatuses.includes(status)) return { error: `无效状态: ${status}` };
  await CollectionMarkService.upsert({
    userId: currentUser.id,
    subjectId: subject_id,
    status,
  });
  return { success: true, subject_id, status };
});

// comment — 发表条目评论
registerTool('comment', {
  description: '在条目详情页发表评论',
  parameters: {
    subject_id: { type: 'number', description: '条目 ID', required: true },
    content: { type: 'string', description: '评论内容', required: true },
  },
}, async (params, { currentUser }) => {
  if (!currentUser?.id) return { error: '请先登录' };
  const { subject_id, content } = params;
  if (!subject_id || !content) return { error: '缺少参数' };
  // 通过 Worker API 发表评论
  const API_BASE = import.meta.env.VITE_OAUTH_PROXY_URL || 'https://anispace-oauth-proxy.lyw2373314970.workers.dev';
  const token = sessionStorage.getItem('acg_jwt_token');
  const res = await fetch(`${API_BASE}/api/subject-comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ subject_id, user_id: currentUser.id, content }),
  });
  if (!res.ok) return { error: '评论发表失败' };
  return { success: true, subject_id };
});

// play_music — 搜索并播放音乐
registerTool('play_music', {
  description: '搜索歌曲并在音乐播放器中播放',
  parameters: {
    query: { type: 'string', description: '歌曲名或关键词', required: true },
  },
}, async (params) => {
  // 返回搜索建议，实际播放由前端处理
  return { suggestion: params.query, action: 'play_music' };
});

// post_forum — 在放課後发帖
registerTool('post_forum', {
  description: '在放課後（论坛）发帖',
  parameters: {
    title: { type: 'string', description: '帖子标题', required: true },
    content: { type: 'string', description: '帖子内容', required: true },
    category: { type: 'string', description: '分类，可选: 讨论/推荐/求助/闲聊', required: false },
  },
}, async (params, { currentUser }) => {
  if (!currentUser?.id) return { error: '请先登录' };
  const { title, content, category } = params;
  if (!title || !content) return { error: '缺少标题或内容' };
  const API_BASE = import.meta.env.VITE_OAUTH_PROXY_URL || 'https://anispace-oauth-proxy.lyw2373314970.workers.dev';
  const token = sessionStorage.getItem('acg_jwt_token');
  const res = await fetch(`${API_BASE}/api/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ author_id: currentUser.id, title, content, category: category || '闲聊' }),
  });
  if (!res.ok) return { error: '发帖失败' };
  const data = await res.json();
  return { success: true, post_id: data.id || data.post_id };
});

// remember — 保存到长期记忆
registerTool('remember', {
  description: '将重要信息保存到长期记忆中，下次对话时可以回忆',
  parameters: {
    key: { type: 'string', description: '记忆的标签/类别', required: true },
    value: { type: 'string', description: '记忆的内容', required: true },
  },
}, async (params, { memoryStore }) => {
  if (!params.key || !params.value) return { error: '缺少参数' };
  memoryStore.save(params.key, params.value);
  return { success: true, key: params.key };
});

// recall — 检索长期记忆
registerTool('recall', {
  description: '从长期记忆中检索信息',
  parameters: {
    query: { type: 'string', description: '检索关键词', required: true },
  },
}, async (params, { memoryStore }) => {
  const results = memoryStore.search(params.query || '');
  return { results };
});

// check_affinity — 查看好感度
registerTool('check_affinity', {
  description: '查看当前与用户的好感度等级',
  parameters: {},
}, async (params, { affinityStore }) => {
  const data = affinityStore.get();
  return {
    score: data.score,
    level: data.level,
    streak_days: data.streakDays,
    total_conversations: data.totalConversations,
  };
});

// gift — 赠送虚拟礼物
registerTool('gift', {
  description: '向角色赠送虚拟礼物，增加好感度',
  parameters: {
    item: { type: 'string', description: '礼物名称', required: true },
  },
}, async (params, { affinityStore }) => {
  const item = (params.item || '').trim();
  if (!item) return { error: '请指定礼物' };
  const bonus = Math.min(item.length * 2, 10); // 简单计算，名字越长加分越多（上限10）
  affinityStore.addScore(bonus);
  affinityStore.addGift(item);
  const data = affinityStore.get();
  return { success: true, item, bonus, new_score: data.score, level: data.level };
});

// ─── 指令解析（兼容旧 ```navi``` 块格式） ───

/** 追加到 system prompt 的站内动作指令说明 */
export const DIRECTIVE_GUIDE = `【站内动作】当你需要帮用户执行操作时，可在回复正文之后追加一个 \`\`\`navi 代码块，块内每行一个 JSON 指令（可多行）：
${getToolGuideText()}
规则：正文用角色口吻自然表达；不要把作品 ID 或链接写进正文（交给系统检索）；不需要执行动作时就不要输出该代码块。`;

const NAVI_BLOCK_RE = /```navi\s*([\s\S]*?)```/i;

/** 从模型回复中解析站内动作，返回 { cleanText, actions } */
export function parseDirectives(rawText) {
  if (!rawText) return { cleanText: '', actions: [] };
  const match = rawText.match(NAVI_BLOCK_RE);
  if (!match) return { cleanText: rawText.trim(), actions: [] };
  const cleanText = rawText.replace(NAVI_BLOCK_RE, '').trim();
  const actions = [];
  for (const line of match[1].split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t);
      if (obj && typeof obj.action === 'string') actions.push(obj);
    } catch { /* 忽略无法解析的指令行 */ }
  }
  return { cleanText, actions };
}

/** 把 goto 动作解析为 { route, label }，非法返回 null */
export function resolveGoto(action) {
  const route = resolveRoute(action.target);
  if (!route) return null;
  return { route, label: action.target };
}

/**
 * 执行 search / recommend 动作：调 BangumiService 取真实条目。
 * 保留向后兼容。
 */
export async function runSearchAction(action, BangumiService) {
  return executeTool(action.action, action, { BangumiService });
}

/**
 * 执行任意已注册工具的动作。
 * @param {object} action - { action: string, ...params }
 * @param {object} context - 上下文对象
 * @returns {object} 执行结果
 */
export async function runAction(action, context) {
  return executeTool(action.action, action, context);
}
