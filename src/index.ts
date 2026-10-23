import { join } from 'node:path';
import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { defaults, type MusicConfig } from './config.ts';
import { MusicWorld, toolDecls } from './world.ts';

const definition: WorldDefinition<MusicConfig> = {
  id: 'netease-music', label: '一起听 · 网易云音乐', defaults,
  preflight(ctx) {
    if (process.platform !== 'win32') throw new Error('此版本需要 Windows 10 1809+ / Windows 11');
    try { new RegExp(ctx.cfg.sessionPattern); }
    catch { throw new Error('媒体会话应用名匹配不是有效正则表达式'); }
  },
  create: ctx => new MusicWorld(ctx.cfg, patch => ctx.persist(patch), undefined, undefined, ctx.dataDir ? join(ctx.dataDir, 'netease-companion') : ''),
  describe: {
    tools: describeTools(toolDecls, {
      music_now_playing: { zh: '读取当前曲目、来源与信息新鲜度。', en: 'Read current track metadata and freshness.' },
      music_recent_tracks: { zh: '查看本次运行最近观察到的 20 首曲目。', en: 'Read the last 20 observed tracks in this run.' },
      music_song_comments: { zh: '参考当前歌曲的热门与最新评论、匹配依据及版本不确定性；开启歌曲背景时附带百度百科词条。', en: 'Read hot and recent song comments with matching uncertainty, plus the song background when enabled.' },
      music_artist_context: { zh: '读取当前歌手简介、别名、代表作品、专辑与第三方背景摘录（需开启歌手资料开关）。', en: 'Read the current artist profile, works, albums and labeled background excerpts when the artist context switch is on.' },
      music_set_commentary: { zh: '保存切歌评论开关。', en: 'Persist the music commentary preference.' },
      music_comment_preference: { zh: '记录用户明确表达过的评论口味，写入本插件独立的偏好文件。', en: 'Record an explicit comment-style preference in this plugin\'s own preference file.' },
    }),
    events: [{ type: 'netease-music.comment_opportunity', description: {
      zh: '曲目稳定且满足评论间隔时，提供一次可选的陪听评论机会；按开关附带评论区摘录与歌手资料。',
      en: 'An optional commentary opportunity after track settling and cooldown, with comments and artist context when enabled.',
    } }, { type: 'netease-music.comment_requested', description: {
      zh: '曲目与评论外部数据入队后，内部机制请求桌宠检查当前曲目并主动发言。',
      en: 'An internal mechanism cue to check current music and speak after external metadata is queued.',
    } }],
  },
};
export default definition;
