// DanmakuService.ts - 弹幕服务

export interface DanmakuItem {
  time: number;       // 视频内时间（秒）
  type: number;       // 0=滚动 1=顶部 2=底部
  color: string;      // 颜色（#FFFFFF 格式）
  author: string;     // 发送者
  text: string;       // 弹幕内容
}

export interface DanmakuProvider {
  fetchDanmaku(episodeId: string): Promise<DanmakuItem[]>;
  sendDanmaku(episodeId: string, danmaku: Omit<DanmakuItem, 'author'>, token?: string): Promise<boolean>;
  readonly name: string;
}

// DanDanPlay third-party provider
class DanDanPlayProvider implements DanmakuProvider {
  readonly name = 'DanDanPlay';
  // Use Worker proxy to bypass CORS restrictions
  private proxyBase: string;

  constructor() {
    // Read proxy URL from env (same as other services)
    let rawBase = '';
    try {
      if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_OAUTH_PROXY_URL) {
        rawBase = import.meta.env.VITE_OAUTH_PROXY_URL;
      }
    } catch {}
    this.proxyBase = rawBase || 'https://anispace-oauth-proxy.lyw2373314970.workers.dev';
  }

  async fetchDanmaku(episodeId: string): Promise<DanmakuItem[]> {
    try {
      // Route through Worker proxy to bypass CORS
      const url = `${this.proxyBase}/api/danmaku/comment/${episodeId}`;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return [];
      const data = await res.json();
      if (!data?.comments) return [];

      return data.comments.map((c: any) => ({
        time: c.p / 1000 || 0,  // DanDanPlay uses milliseconds
        type: c.mode || 0,
        color: `#${(c.color || 0xFFFFFF).toString(16).padStart(6, '0')}`,
        author: c.user?.nickname || `user${c.user?.uid || ''}`,
        text: c.text || '',
      }));
    } catch {
      return [];
    }
  }

  async sendDanmaku(episodeId: string, danmaku: Omit<DanmakuItem, 'author'>, token?: string): Promise<boolean> {
    // DanDanPlay requires authentication for sending
    // For now, return false (not supported without user's DanDanPlay token)
    return false;
  }
}

// Self-built API provider (预留)
class SelfBuiltProvider implements DanmakuProvider {
  readonly name = 'SelfBuilt';
  private apiBase: string;

  constructor(apiBase: string) {
    this.apiBase = apiBase;
  }

  async fetchDanmaku(episodeId: string): Promise<DanmakuItem[]> {
    try {
      const url = `${this.apiBase}/api/danmaku/list?episodeId=${encodeURIComponent(episodeId)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return [];
      const data = await res.json();
      if (!Array.isArray(data)) return [];

      return data.map((c: any) => ({
        time: c.time || 0,
        type: c.type || 0,
        color: c.color || '#FFFFFF',
        author: c.author || '匿名',
        text: c.content || c.text || '',
      }));
    } catch {
      return [];
    }
  }

  async sendDanmaku(episodeId: string, danmaku: Omit<DanmakuItem, 'author'>, token?: string): Promise<boolean> {
    try {
      const url = `${this.apiBase}/api/danmaku/send`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          episode_id: episodeId,
          content: danmaku.text,
          time: danmaku.time,
          type: danmaku.type,
          color: danmaku.color,
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

// Main DanmakuService
class DanmakuService {
  private providers: DanmakuProvider[] = [];
  private cache = new Map<string, { data: DanmakuItem[]; timestamp: number }>();
  private CACHE_TTL = 10 * 60 * 1000; // 10 minutes

  constructor() {
    // Register providers in priority order
    this.providers.push(new DanDanPlayProvider());
    // Self-built provider will be registered when API is available
  }

  registerProvider(provider: DanmakuProvider): void {
    this.providers.push(provider);
  }

  async fetchDanmaku(episodeId: string): Promise<DanmakuItem[]> {
    if (!episodeId) return [];

    // Check cache
    const cached = this.cache.get(episodeId);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    // Try providers in order
    for (const provider of this.providers) {
      try {
        const danmaku = await provider.fetchDanmaku(episodeId);
        if (danmaku.length > 0) {
          this.cache.set(episodeId, { data: danmaku, timestamp: Date.now() });
          return danmaku;
        }
      } catch {
        continue; // Try next provider
      }
    }

    return []; // No provider had danmaku
  }

  async sendDanmaku(episodeId: string, danmaku: Omit<DanmakuItem, 'author'>, token?: string): Promise<boolean> {
    for (const provider of this.providers) {
      try {
        const success = await provider.sendDanmaku(episodeId, danmaku, token);
        if (success) {
          // Invalidate cache
          this.cache.delete(episodeId);
          return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export const danmakuService = new DanmakuService();
