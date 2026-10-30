import { join } from 'node:path';
import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { defaults, playerOrder, type MusicConfig } from './config.ts';
import { MusicWorld, toolDecls } from './world.ts';

const definition: WorldDefinition<MusicConfig> = {
  id: 'netease-music', label: '听搭子', defaults,
  preflight(ctx) {
    if (process.platform !== 'win32') throw new Error('此版本需要 Windows 10 1809+ / Windows 11');
    const priority = playerOrder(ctx.cfg.playerPriority);
    if (JSON.stringify(priority) !== JSON.stringify(ctx.cfg.playerPriority)) ctx.persist({ playerPriority: priority });
    const memoryDir = String(ctx.cfg.memoryDir ?? '').trim().slice(0, 300);
    if (memoryDir !== (ctx.cfg.memoryDir ?? '')) ctx.persist({ memoryDir });
  },
  create: ctx => new MusicWorld(ctx.cfg, patch => ctx.persist(patch), undefined, undefined, ctx.dataDir ? join(ctx.dataDir, 'netease-companion') : ''),
  describe: {
    tools: describeTools(toolDecls, {
      music_now_playing: { zh: '读取当前曲目、来源与信息新鲜度。', en: 'Read current track metadata and freshness.' },
      music_recent_tracks: { zh: '查看本次运行最近观察到的 20 首曲目。', en: 'Read the last 20 observed tracks in this run.' },
      music_listening_memory: { zh: '读取本机听歌记忆：常听歌手、最常播放与最近曲目，以及当前曲目/歌手以前是否听过。', en: 'Read local listening memory: top artists, most played and recent tracks, and whether the current track or artist was heard before.' },
      music_song_comments: { zh: '参考当前歌曲的热门与最新评论、匹配依据及版本不确定性；开启歌曲背景时附带百度百科词条。', en: 'Read hot and recent song comments with matching uncertainty, plus the song background when enabled.' },
      music_artist_context: { zh: '读取当前歌手简介、别名、代表作品、专辑与第三方背景摘录（需开启歌手资料开关）。', en: 'Read the current artist profile, works, albums and labeled background excerpts when the artist context switch is on.' },
      music_control: { zh: '仅在用户明确要求时暂停、继续、切上一首或下一首；需在设置中允许播放控制。', en: 'Pause, resume, skip previous/next only when explicitly asked, and only when playback control is allowed.' },
      music_pick: { zh: '搜索网易云与 QQ 音乐曲库并挑一首，返回曲目、链接与想听清单编号；不带 query 时列出想听清单，带 from 时直接认领其中一首。不能自动播放。', en: 'Search NetEase and QQ Music, pick a track and return its link plus a wish-list id; without query it lists the wish list, with from it re-picks one id. Playback cannot be started by the World.' },
      music_soul: { zh: '读取或编辑她自己写的口味档案 music-soul.md：第一人称，只支持追加与删除，不能整篇覆写。', en: 'Read or edit her own first-person taste file music-soul.md; append and drop only, never a full rewrite.' },
      music_note: { zh: '把用户明确说过的一句歌曲笔记写入本插件独立的笔记文件，以后再听到时可以参考。', en: 'Save one explicit user note about the current song in this plugin\'s own notes file.' },
      music_tag: { zh: '给当前曲目标一个听感标签（烈/柔/旧/怪/淡）和可选曲风，后续分段沿用。', en: 'Tag the current track\'s feel and optional genre for later passages.' },
      music_history: { zh: '读取本机最近几天的逐日听歌记录：播放次数、曲目、歌手、时段与播放器。', en: 'Read the local per-day listening log for the last days.' },
      music_taste: { zh: '读取较长时间窗口的听歌口味摘要：常听歌手、循环曲、时段与播放器占比。', en: 'Read a longer-window local taste summary.' },
      music_set_commentary: { zh: '保存切歌评论开关。', en: 'Persist the music commentary preference.' },
      music_comment_preference: { zh: '记录用户明确表达过的评论口味与主动互动频率，写入本插件独立的画像文件。', en: 'Record an explicit comment-style preference or interaction cadence in this plugin\'s own profile file.' },
    }),
    events: [{ type: 'netease-music.comment_opportunity', description: {
      zh: '曲目稳定且满足评论间隔时，提供一次可选的陪听评论机会；按开关附带评论区摘录、歌手资料、用户画像与听歌记忆。事件带本次评论侧重 commentFocus；分段时还附带按播放比例估的段落与当前段歌词窗口，副歌可能带 style 动作建议。',
      en: 'An optional commentary opportunity after track settling and cooldown, with comments, artist context, user profile and listening memory when enabled. It carries a commentFocus angle; segmented opportunities also carry an estimated song section, a lyric window around the current position, and style-based action suggestions in the chorus.',
    } }, { type: 'netease-music.comment_requested', description: {
      zh: '曲目与评论外部数据入队后，内部机制请求桌宠检查当前曲目并主动发言。',
      en: 'An internal mechanism cue to check current music and speak after external metadata is queued.',
    } }, { type: 'netease-music.state_requested', description: {
      zh: '播放器暂停、恢复或结束时，请求桌宠用一句很短的话回应；不带外部资料。',
      en: 'A short cue when playback pauses, resumes or ends; no external data is attached.',
    } }, { type: 'netease-music.relay_pick', description: {
      zh: '她之前用 music_pick 递出的那首快结束时（约剩 35 秒）触发一次，附带想听清单里还能接的几首（带 id），请用 music_pick 的 from 直接认领下一棒；同一首只提醒一次，链最多 6 首。',
      en: 'Fired once when a track she picked earlier is about to end (about 35 seconds left); carries the remaining wish-list ids so the next pick can be claimed with music_pick from. Each track is relayed only once, at most six in a chain.',
    } }],
  },
};
export default definition;
