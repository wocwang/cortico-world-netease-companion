import type { ConfigGroup } from 'cortico/core/types.ts';

export interface MusicConfig {
  enabled: boolean;
  commentary: boolean;
  settleSeconds: number;
  cooldownSeconds: number;
  sessionPattern: string;
  windowFallback: boolean;
  windowFallbackProcess: string;
  commentReference: boolean;
  maxCommentChars: number;
  commentExcerpts: number;
  artistContext: boolean;
  songContext: boolean;
  lyricsContext: boolean;
  lyricsTranslation: boolean;
  lyricsLines: number;
  listeningTrackLimit: number;
  listeningArtistLimit: number;
  listeningRankTrackRange: number;
  listeningRankArtistRange: number;
}
export const defaults = (): MusicConfig => ({
  enabled: false, commentary: true, settleSeconds: 8, cooldownSeconds: 120,
  sessionPattern: 'cloudmusic|netease|网易云|QQMusic|qqmusic', windowFallback: true,
  windowFallbackProcess: 'cloudmusic|QQMusic|qqmusic', commentReference: true, maxCommentChars: 80,
  commentExcerpts: 10, artistContext: true, songContext: true,
  lyricsContext: true, lyricsTranslation: true, lyricsLines: 12,
  listeningTrackLimit: 100, listeningArtistLimit: 30,
  listeningRankTrackRange: 100, listeningRankArtistRange: 30,
});
export function listeningLimits(cfg: MusicConfig): { tracks: number; artists: number; rankTracks: number; rankArtists: number } {
  const bounded = (value: number, fallback: number, min: number, max: number) =>
    Number.isFinite(value) ? Math.floor(Math.max(min, Math.min(max, value))) : fallback;
  const tracks = bounded(cfg.listeningTrackLimit, 100, 10, 500);
  const artists = bounded(cfg.listeningArtistLimit, 30, 5, 100);
  return {
    tracks, artists,
    rankTracks: Math.min(tracks, bounded(cfg.listeningRankTrackRange, tracks, 1, 500)),
    rankArtists: Math.min(artists, bounded(cfg.listeningRankArtistRange, artists, 1, 100)),
  };
}
export function commentLimits(cfg: MusicConfig): { maxChars: number; intervalSeconds: number; excerpts: number } {
  const bounded = (value: number, fallback: number, min: number, max: number) =>
    Number.isFinite(value) ? Math.floor(Math.max(min, Math.min(max, value))) : fallback;
  return { maxChars: bounded(cfg.maxCommentChars, 80, 10, 500), intervalSeconds: bounded(cfg.cooldownSeconds, 120, 30, 3600),
    excerpts: bounded(cfg.commentExcerpts, 10, 3, 50) };
}
export function lyricLimits(cfg: MusicConfig): { lines: number } {
  const value = cfg.lyricsLines;
  return { lines: Number.isFinite(value) ? Math.floor(Math.max(3, Math.min(80, value))) : 12 };
}
const owner = 'world:netease-music' as const;

/** 配置按用途拆成多个组，标准配置页会分成短分区；WebUI 的「设置」页再把它们做成可折叠卡片。 */
export const configGroups: ConfigGroup[] = [
  {
    id: 'world:netease-music:commentary', owner, schema: {
      type: 'object', title: '陪听与评论', description: '目前支持网易云音乐与 QQ 音乐；评论、歌曲百科、歌手资料和歌词通过网易云数据补充，QQ 音乐独家内容可能无法匹配。',
      properties: {
        'worlds.netease-music.commentary': { type: 'boolean', title: '允许切歌评论', 'x-hot': true },
        'worlds.netease-music.settleSeconds': { type: 'number', title: '曲目稳定等待（秒）', minimum: 2, maximum: 120, 'x-hot': true },
        'worlds.netease-music.cooldownSeconds': { type: 'integer', title: '主动评论最短间隔（秒）', description: '30–3600 秒。间隔越大评论越少；陪听画像会按用户明确要求的互动频率自动缩放实际间隔。仅在曲目稳定且满足间隔时触发，不是定时重复评论。', minimum: 30, maximum: 3600, 'x-hot': true },
        'worlds.netease-music.maxCommentChars': { type: 'integer', title: '评论最大字数', description: '10–500，默认 80。包含标点、数字与外语字符；只约束音乐主动评论，由桌宠模型遵循，不截断其他聊天。', minimum: 10, maximum: 500, 'x-hot': true },
        'worlds.netease-music.commentExcerpts': { type: 'integer', title: '评论参考条数', description: '3–50，默认 10。会先过滤求赞、打卡等低信息评论，再按信息量、点赞和新鲜度排序；条数越多上下文越长。', minimum: 3, maximum: 50, 'x-hot': true },
      },
    },
  },
  {
    id: 'world:netease-music:context', owner, schema: {
      type: 'object', title: '联网背景资料', description: '评论区、歌手资料与歌曲背景各自独立；关闭评论区后不会单独请求歌曲背景。',
      properties: {
        'worlds.netease-music.commentReference': { type: 'boolean', title: '参考评论区（联网）', 'x-hot': true },
        'worlds.netease-music.artistContext': { type: 'boolean', title: '联网搜索歌手背景资料', description: '开启后读取歌手简介、代表作品与专辑，并补充百度百科概述和 Discogs 社区档案；与「参考评论区」相互独立。', 'x-hot': true },
        'worlds.netease-music.songContext': { type: 'boolean', title: '联网搜索歌曲背景资料', description: '开启后随评论参考读取百度百科歌曲词条（创作背景、词曲、专辑、发行日期）和歌曲百科（曲风、标签、BPM、获奖、乐评、相似歌曲）；关闭评论区参考时不会单独请求。', 'x-hot': true },
      },
    },
  },
  {
    id: 'world:netease-music:lyrics', owner, schema: {
      type: 'object', title: '歌词', description: '官方 LRC 只作引用；没有官方翻译时不生成译文。',
      properties: {
        'worlds.netease-music.lyricsContext': { type: 'boolean', title: '参考歌词（联网）', description: '开启后按当前曲目获取官方 LRC，切歌时随事件带上歌词摘要（默认前 12 行 + 当前行）；与「参考评论区」相互独立。', 'x-hot': true },
        'worlds.netease-music.lyricsTranslation': { type: 'boolean', title: '歌词附带中文翻译', description: '外文歌有官方翻译时按时间戳逐行合并；没有翻译的曲目不会输出伪造译文。', 'x-hot': true },
        'worlds.netease-music.lyricsLines': { type: 'integer', title: '歌词摘要行数', description: '3–80，默认 12。切歌事件里带多少行歌词；调小可节省上下文，想听全首时可以让桌宠调用 music_lyrics。', minimum: 3, maximum: 80, 'x-hot': true },
      },
    },
  },
  {
    id: 'world:netease-music:listening', owner, schema: {
      type: 'object', title: '一起听排名', description: '收录上限影响本地保存数量，显示范围只影响榜单展示；显示范围超过收录上限时按上限显示。',
      properties: {
        'worlds.netease-music.listeningTrackLimit': { type: 'integer', title: '一起听排名歌曲收录上限', description: '10–500，默认 100。超过上限时保留播放次数与歌手出现次数更高的歌曲；同分时随机替换，新听到的歌先进入候补。', minimum: 10, maximum: 500, 'x-hot': true },
        'worlds.netease-music.listeningArtistLimit': { type: 'integer', title: '一起听排名歌手收录上限', description: '5–100，默认 30。超过上限时保留出现次数更高的歌手；同分时随机替换，新听到的歌手先进入候补。', minimum: 5, maximum: 100, 'x-hot': true },
        'worlds.netease-music.listeningRankTrackRange': { type: 'integer', title: '一起听排名显示歌曲数', description: '1–500，默认 100。只改变榜单显示前多少名，不改变实际收录上限；超过收录上限时按收录上限显示。', minimum: 1, maximum: 500, 'x-hot': true },
        'worlds.netease-music.listeningRankArtistRange': { type: 'integer', title: '一起听排名显示歌手数', description: '1–100，默认 30。只改变榜单显示前多少名，不改变实际收录上限；超过收录上限时按收录上限显示。', minimum: 1, maximum: 100, 'x-hot': true },
      },
    },
  },
  {
    id: 'world:netease-music:reader', owner, schema: {
      type: 'object', title: '媒体读取', description: '修改后需重启 World；这些配置只影响读取通道，不匹配歌曲内容。',
      properties: {
        'worlds.netease-music.sessionPattern': { type: 'string', title: '媒体会话应用名匹配（网易云音乐 / QQ 音乐，重启生效）', description: '目前支持网易云音乐与 QQ 音乐。匹配 Windows SMTC 的应用名；其他播放器可自行加入，修改后重启 World。', 'x-hot': false },
        'worlds.netease-music.windowFallback': { type: 'boolean', title: '启用窗口标题降级（重启生效）', 'x-hot': false },
        'worlds.netease-music.windowFallbackProcess': { type: 'string', title: '窗口标题降级的进程名匹配（正则，重启生效）', description: '默认 cloudmusic|QQMusic|qqmusic。仅在 SMTC 不可用时读取这些进程的窗口标题；修改后重启 World。', 'x-hot': false },
      },
    },
  },
];
