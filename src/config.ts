import type { ConfigGroup } from 'cortico/core/types.ts';

export interface MusicConfig {
  enabled: boolean;
  commentary: boolean;
  settleSeconds: number;
  cooldownSeconds: number;
  sessionPattern: string;
  windowFallback: boolean;
  commentReference: boolean;
  maxCommentChars: number;
  commentExcerpts: number;
  artistContext: boolean;
}
export const defaults = (): MusicConfig => ({
  enabled: false, commentary: true, settleSeconds: 8, cooldownSeconds: 120,
  sessionPattern: 'cloudmusic|netease|网易云', windowFallback: true, commentReference: true, maxCommentChars: 80,
  commentExcerpts: 10, artistContext: true,
});
export function commentLimits(cfg: MusicConfig): { maxChars: number; intervalSeconds: number; excerpts: number } {
  const bounded = (value: number, fallback: number, min: number, max: number) =>
    Number.isFinite(value) ? Math.floor(Math.max(min, Math.min(max, value))) : fallback;
  return { maxChars: bounded(cfg.maxCommentChars, 80, 10, 500), intervalSeconds: bounded(cfg.cooldownSeconds, 120, 30, 3600),
    excerpts: bounded(cfg.commentExcerpts, 10, 3, 20) };
}
export const configGroup: ConfigGroup = {
  id: 'world:netease-music', owner: 'world:netease-music', schema: {
    type: 'object', title: '一起听 · 网易云音乐', properties: {
      'worlds.netease-music.commentReference': { type: 'boolean', title: '参考网易云评论区（联网）', 'x-hot': true },
      'worlds.netease-music.artistContext': { type: 'boolean', title: '参考歌手资料（联网）', description: '开启后额外读取网易云歌手简介、代表作品与专辑信息，帮助理解曲风和作品背景；不替代评论区。', 'x-hot': true },
      'worlds.netease-music.commentExcerpts': { type: 'integer', title: '评论参考条数', description: '3–20，默认 10。热门约占六成，其余为最新；条数越多上下文越长。', minimum: 3, maximum: 20, 'x-hot': true },
      'worlds.netease-music.commentary': { type: 'boolean', title: '允许切歌评论', 'x-hot': true },
      'worlds.netease-music.settleSeconds': { type: 'number', title: '曲目稳定等待（秒）', minimum: 2, maximum: 120, 'x-hot': true },
      'worlds.netease-music.cooldownSeconds': { type: 'integer', title: '主动评论最短间隔（秒）', description: '30–3600 秒。间隔越大评论越少；仅在曲目稳定且满足间隔时触发，不是定时重复评论。', minimum: 30, maximum: 3600, 'x-hot': true },
      'worlds.netease-music.maxCommentChars': { type: 'integer', title: '评论最大字数', description: '10–500，默认 80。包含标点、数字与外语字符；只约束音乐主动评论，由桌宠模型遵循，不截断其他聊天。', minimum: 10, maximum: 500, 'x-hot': true },
      'worlds.netease-music.sessionPattern': { type: 'string', title: '媒体会话应用名匹配（正则，重启生效）' },
      'worlds.netease-music.windowFallback': { type: 'boolean', title: '启用窗口标题降级（重启生效）' },
    },
  },
};
