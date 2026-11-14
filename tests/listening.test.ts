import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ListeningMemoryStore, LISTENING_DWELL_MS, ReplayCounter } from '../src/listening.ts';
import { MusicWorld } from '../src/world.ts';
import { defaults, listeningLimits } from '../src/config.ts';
import type { Track } from '../src/state.ts';

const temp = () => mkdtemp(join(tmpdir(), 'netease-listening-'));
const media = (over: Partial<Track> = {}): Track => ({
  title: '晴天', artist: '周杰伦', album: '叶惠美', app: 'cloudmusic', status: 'playing', method: 'smtc', ...over,
});

test('听歌记忆聚合曲目与歌手，并给出常听摘要和当前曲目关联', async () => {
  const dir = await temp();
  try {
    const store = new ListeningMemoryStore(dir);
    const at = Date.parse('2026-10-24T10:00:00Z');
    await store.record({ title: '晴天', artist: '周杰伦', album: '叶惠美' }, at);
    await store.record({ title: '晴天', artist: '周杰伦', album: '叶惠美' }, at + 1000);
    await store.record({ title: '起风了', artist: '买辣椒也用券', album: '起风了' }, at + 2000);
    const view = await store.view();
    assert.equal(view.totalPlays, 3);
    assert.equal(view.trackCount, 2);
    assert.equal(view.artistCount, 2);
    assert.equal(view.topArtists[0].name, '周杰伦');
    assert.equal(view.topArtists[0].count, 2);
    assert.equal(view.topTracks[0].title, '晴天');
    assert.match(view.summary, /累计记录 3 次播放/);
    assert.match(view.summary, /周杰伦（2 次）/);
    const relation = await store.relation({ title: '晴天', artist: '周杰伦', album: '叶惠美' });
    assert.equal(relation.track?.count, 2);
    assert.equal(relation.artist?.count, 2);
    assert.equal((await store.relation({ title: '未知', artist: '未知' })).track, undefined);
    const raw = JSON.parse(await readFile(join(dir, 'listening.json'), 'utf8'));
    assert.equal(raw.version, 2);
    assert.equal(raw.totalPlays, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('听歌记忆默认最多保留 100 首与 30 位歌手，同分按随机顺序替换', async () => {
  const dir = await temp();
  try {
    const store = new ListeningMemoryStore(dir, () => ({ tracks: 100, artists: 30 }), () => 0);
    const at = Date.parse('2026-01-01T00:00:00Z');
    for (let i = 0; i < 105; i++) {
      await store.record({ title: `歌-${i}`, artist: `歌手-${i}`, album: '' }, at + i * 1000);
    }
    const view = await store.view(120);
    assert.equal(view.totalPlays, 105);
    assert.equal(view.trackCount, 100);
    assert.equal(view.artistCount, 30);
    assert.ok(view.recentTracks.some(t => t.title === '歌-104'));
    assert.ok(!view.recentTracks.some(t => t.title === '歌-4'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('超过歌曲上限时淘汰播放次数加歌手次数最低的旧歌，同分随机且保护新歌', async () => {
  const dir = await temp();
  try {
    const store = new ListeningMemoryStore(dir, () => ({ tracks: 10, artists: 20 }), () => 0);
    const at = Date.parse('2026-02-01T00:00:00Z');
    for (const [i, title] of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'].entries()) {
      await store.record({ title, artist: `歌手${title}`, album: '' }, at + i * 1000);
    }
    let ranking = await store.ranking();
    assert.equal(ranking.tracks.length, 10);
    assert.ok(!ranking.tracks.some(t => t.title === 'A'));
    assert.ok(ranking.tracks.some(t => t.title === 'K'));
    await store.record({ title: 'B', artist: '歌手B', album: '' }, at + 11_000);
    await store.record({ title: 'L', artist: '歌手L', album: '' }, at + 12_000);
    ranking = await store.ranking();
    assert.equal(ranking.tracks.length, 10);
    assert.equal(ranking.tracks.find(t => t.title === 'B')?.count, 2);
    assert.ok(!ranking.tracks.some(t => t.title === 'C'));
    assert.ok(ranking.tracks.some(t => t.title === 'L'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('听歌排名按次数排序，并分别套用收录上限与显示范围', async () => {
  const dir = await temp();
  try {
    const store = new ListeningMemoryStore(dir, () => ({ tracks: 10, artists: 5, rankTracks: 4, rankArtists: 2 }), () => 0);
    const at = Date.parse('2026-03-01T00:00:00Z');
    await store.record({ title: 'A', artist: '歌手A', album: '' }, at);
    await store.record({ title: 'A', artist: '歌手A', album: '' }, at + 1000);
    for (const [i, title] of ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'].entries()) {
      await store.record({ title, artist: `歌手${title}`, album: '' }, at + 2000 + i * 1000);
    }
    const ranking = await store.ranking();
    assert.deepEqual(ranking.limits, { tracks: 10, artists: 5, rankTracks: 4, rankArtists: 2 });
    assert.equal(ranking.storedTracks, 10);
    assert.equal(ranking.storedArtists, 5);
    assert.equal(ranking.tracks.length, 4);
    assert.equal(ranking.tracks[0].title, 'A');
    assert.equal(ranking.tracks[0].count, 2);
    assert.equal(ranking.tracks[1].title, 'K');
    assert.equal(ranking.tracks[2].title, 'J');
    assert.ok(!ranking.tracks.some(t => t.title === 'B'));
    assert.equal(ranking.artists.length, 2);
    assert.equal(ranking.artists[0].name, '歌手A');
    assert.equal(ranking.artists[0].count, 2);
    assert.equal(ranking.artists[1].name, '歌手K');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('排名显示范围可配置，并受收录上限约束', () => {
  const cfg = defaults();
  assert.deepEqual(listeningLimits(cfg), { tracks: 100, artists: 30, rankTracks: 100, rankArtists: 30 });
  cfg.listeningTrackLimit = 999;
  cfg.listeningArtistLimit = 1;
  cfg.listeningRankTrackRange = 20;
  cfg.listeningRankArtistRange = 999;
  assert.deepEqual(listeningLimits(cfg), { tracks: 500, artists: 5, rankTracks: 20, rankArtists: 5 });
  cfg.listeningRankTrackRange = 0;
  cfg.listeningRankArtistRange = 0;
  assert.deepEqual(listeningLimits(cfg), { tracks: 500, artists: 5, rankTracks: 1, rankArtists: 1 });
});

test('没有播放位置时按曲目时长累计循环，暂停时间不计', () => {
  const counter = new ReplayCounter();
  const t = media();
  let now = 0, plays = 0;
  counter.reset('k', t, now);
  for (now = 2000; now <= 60_000; now += 2000) plays += counter.update('k', t, 60_000, now);
  assert.equal(plays, 1);
  for (let i = 0; i < 15; i++) { now += 2000; plays += counter.update('k', media({ status: 'paused' }), 60_000, now); }
  assert.equal(plays, 1);
  for (let i = 0; i < 30; i++) { now += 2000; plays += counter.update('k', t, 60_000, now); }
  assert.equal(plays, 2);
});

test('有播放位置时按结尾回到开头计一次，普通回拖不计数', () => {
  const counter = new ReplayCounter();
  let plays = 0;
  counter.reset('k', media({ positionSeconds: 0 }), 0);
  plays += counter.update('k', media({ positionSeconds: 2 }), 60_000, 2000);
  plays += counter.update('k', media({ positionSeconds: 58 }), 60_000, 58_000);
  plays += counter.update('k', media({ positionSeconds: 0 }), 60_000, 60_000);
  assert.equal(plays, 1);
  plays += counter.update('k', media({ positionSeconds: 2 }), 60_000, 62_000);
  plays += counter.update('k', media({ positionSeconds: 30 }), 60_000, 90_000);
  plays += counter.update('k', media({ positionSeconds: 10 }), 60_000, 100_000);
  assert.equal(plays, 1);
});

test('听歌记忆支持一次累加多次循环', async () => {
  const dir = await temp();
  try {
    const store = new ListeningMemoryStore(dir);
    const at = Date.parse('2026-10-25T10:00:00Z');
    await store.record({ title: '晴天', artist: '周杰伦', album: '叶惠美' }, at, 3);
    const view = await store.view();
    assert.equal(view.totalPlays, 3);
    assert.equal(view.topTracks[0].count, 3);
    assert.equal(view.topArtists[0].count, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('按保留天数清理旧记录，并重建累计排名', async () => {
  const dir = await temp();
  try {
    const store = new ListeningMemoryStore(dir);
    const now = Date.now();
    await store.record({ title: '旧歌', artist: '旧歌手', album: '' }, now - 4000 * 86_400_000);
    await store.record({ title: '旧歌', artist: '旧歌手', album: '' }, now - 40 * 86_400_000);
    await store.record({ title: '旧歌', artist: '旧歌手', album: '' }, now - 40 * 86_400_000 + 1000);
    await store.record({ title: '新歌', artist: '新歌手', album: '' }, now - 2 * 86_400_000);
    const all = await store.history(36_500);
    assert.equal(all.days.length, 3);
    const preview = await store.prunePreview(30, now);
    assert.equal(preview.removedDays, 2);
    assert.equal(preview.removedPlays, 3);
    assert.equal(preview.keptDays, 1);
    assert.equal(preview.keptPlays, 1);
    assert.equal((await store.history(36_500)).days.length, 3);
    const result = await store.prune(30, now);
    assert.equal(result.keepDays, 30);
    assert.equal(result.removedDays, 2);
    assert.equal(result.removedPlays, 3);
    assert.equal(result.keptDays, 1);
    assert.equal(result.keptPlays, 1);
    assert.equal(result.keptTracks, 1);
    assert.equal(result.keptArtists, 1);
    const view = await store.view();
    assert.equal(view.totalPlays, 1);
    assert.deepEqual(view.topTracks.map(t => t.title), ['新歌']);
    assert.deepEqual(view.topArtists.map(a => a.name), ['新歌手']);
    const again = await store.prune(30, now);
    assert.equal(again.removedDays, 0);
    assert.equal(again.keptDays, 1);
    assert.match(String(store.storage().note), /不会按天数自动删除/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('月历、当天明细与播放器拆分', async () => {
  const dir = await temp();
  try {
    const store = new ListeningMemoryStore(dir);
    const at = Date.parse('2026-04-05T10:00:00Z');
    await store.record({ title: 'A', artist: '歌手A', album: '', app: 'cloudmusic.exe' }, at);
    await store.record({ title: 'B', artist: '歌手B', album: '', app: 'QQMusic.exe' }, at + 3_600_000);
    const month = await store.month('2026-04');
    assert.equal(month.status, 'ok');
    assert.equal(month.days.length, 1);
    assert.equal(month.totalPlays, 2);
    assert.equal(month.days[0].date, '2026-04-05');
    const day = await store.day('2026-04-05');
    assert.equal(day?.tracks.length, 2);
    assert.deepEqual(day?.tracks.find(track => track.title === 'A')?.players, [{ app: 'cloudmusic.exe', count: 1 }]);
    const stats = await store.playerStats();
    assert.deepEqual(stats.map(item => item.app), ['cloudmusic.exe', 'QQMusic.exe']);
    assert.equal(stats[0].plays, 1);
    assert.equal(stats[0].share, 0.5);
    assert.equal(stats[0].days, 1);
    assert.deepEqual(stats[0].topArtists, [{ name: '歌手A', count: 1 }]);
    assert.deepEqual(await store.month('2026-05'), { status: 'empty', month: '2026-05', totalPlays: 0, days: [] });
    assert.equal(await store.day('bad'), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('听歌记忆可持久化并单独清除', async () => {
  const dir = await temp();
  try {
    const store = new ListeningMemoryStore(dir);
    await store.record({ title: '晴天', artist: '周杰伦', album: '叶惠美' }, Date.parse('2026-10-24T10:00:00Z'));
    const reloaded = new ListeningMemoryStore(dir);
    assert.equal((await reloaded.view()).totalPlays, 1);
    assert.match(reloaded.storage().stat(), /1 首/);
    assert.equal(reloaded.storage().location, join(dir, 'listening.json'));
    assert.equal(await reloaded.storage().clear(), '已清除听歌记录（排名与历史）');
    assert.equal((await reloaded.view()).totalPlays, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('同曲分段只在 50% / 80% 触发，并跳过已播位置', () => {
  const world = new MusicWorld({ ...defaults(), segmentComments: true }, () => {});
  const track = media({ durationSeconds: 200 });
  assert.deepEqual((world as any).segmentPoints(track), [100, 160]);
  (world as any).seedSegments({ ...track, positionSeconds: 120 });
  assert.deepEqual([...(world as any).segmentFired], [0]);
  (world as any).seedSegments({ ...track, positionSeconds: 0 });
  assert.deepEqual([...(world as any).segmentFired], []);
  assert.deepEqual((world as any).segmentPoints(media({ durationSeconds: 60 })), []);
});

test('同曲分段支持 3 段和无播放位置时的时间间隔', () => {
  const world = new MusicWorld({ ...defaults(), segmentComments: true, segmentCount: 3 }, () => {});
  assert.deepEqual((world as any).segmentPoints(media({ durationSeconds: 200 })), [80, 130, 170]);

  const fallback = new MusicWorld({ ...defaults(), segmentComments: true, segmentEverySeconds: 60 }, () => {});
  const titled = media({ method: 'window-title', durationSeconds: 200 });
  assert.deepEqual((fallback as any).segmentPoints(titled), [60, 120]);
  (fallback as any).segmentElapsedMs = 130000;
  (fallback as any).seedSegments(titled);
  assert.deepEqual([...(fallback as any).segmentFired], [0, 1]);
});

test('无时间轴时按实际播放时间推进分段与段落估算', () => {
  const realNow = Date.now;
  let fake = realNow();
  Date.now = () => fake;
  try {
    const cfg = { ...defaults(), segmentComments: true, commentReference: false, cooldownSeconds: 30, settleSeconds: 2 };
    const world = new MusicWorld(cfg, () => {});
    const track = media({ timeline: false, positionSeconds: 0, durationSeconds: 200 });
    (world as any).observe({ track });
    fake += 5000;
    (world as any).observe({ track });
    assert.equal((world as any).segmentElapsedMs, 5000);
    assert.equal((world as any).segmentClock(track), 5);
    fake += 5000;
    (world as any).observe({ track });
    const revision = (world as any).state.revision;
    assert.ok((world as any).state.commit(track, revision, fake));
    for (let i = 0; i < 18; ++i) {
      fake += 5000;
      (world as any).observe({ track });
    }
    assert.equal((world as any).segmentOpportunity(cfg, fake)?.index, 0);
    assert.equal((world as any).sectionFor(track)?.label, '副歌');
  } finally {
    Date.now = realNow;
  }
});

test('副歌分段事件带 section、动作建议与语音提示', async () => {
  const realNow = Date.now;
  let fake = realNow();
  Date.now = () => fake;
  try {
    const cfg = { ...defaults(), segmentComments: true, segmentCount: 2, cooldownSeconds: 30, settleSeconds: 2 };
    const comments = {
      get: async () => ({ status: 'ok', excerpts: [], songBackground: { status: 'ok', wiki: { genres: ['摇滚'] } } }),
      getArtist: async () => ({ status: 'unavailable' }),
      lyrics: async () => ({ status: 'unavailable' }),
    };
    const world = new MusicWorld(cfg, () => {}, undefined, comments as any);
    const events: Array<Record<string, any>> = [];
    (world as any).host = {
      pushEvent: async (event: Record<string, any>) => { events.push(event); return { cursor: events.length }; },
      withdrawPending: async () => true,
    };
    const track = media({ timeline: false, positionSeconds: 0, durationSeconds: 200 });
    (world as any).observe({ track });
    fake += 5000;
    (world as any).observe({ track });
    const revision = (world as any).state.revision;
    assert.ok((world as any).state.commit(track, revision, fake));
    for (let i = 0; i < 19; ++i) {
      fake += 5000;
      (world as any).observe({ track });
    }
    assert.ok((world as any).state.hasOffered(track));
    assert.ok((world as any).state.canOffer(cfg, fake));
    assert.equal((world as any).segmentClock(track), 100);
    assert.deepEqual((world as any).segmentPoints(track), [100, 160]);
    assert.deepEqual([...(world as any).segmentFired], []);
    assert.equal((world as any).segmentKey, JSON.stringify([track.title, track.artist, track.album]));
    assert.equal((world as any).segmentOpportunity(cfg, fake)?.index, 0);
    await (world as any).tick(fake);
    const external = events.find(event => event.type === 'netease-music.comment_opportunity')!;
    const payload = JSON.parse(external.text);
    assert.equal(payload.phase, 'segment');
    assert.equal(payload.section?.id, 'chorus');
    assert.equal(payload.segment?.positionSeconds, 100);
    assert.equal(payload.style?.id, 'energetic');
    assert.equal(payload.style?.label, '偏燃');
    assert.equal('actions' in (payload.style ?? {}), false);
    const cue = events.find(event => event.type === 'netease-music.comment_requested')!;
    assert.match(cue.text, /sovits_speak/);
    assert.match(cue.text, /桌宠环境提示词/);
    assert.match(cue.text, /副歌/);
  } finally {
    Date.now = realNow;
  }
});

test('分段事件不重发开场已给的上下文，用 reuse 指明按需读取入口', async () => {
  const realNow = Date.now;
  let fake = realNow();
  Date.now = () => fake;
  try {
    const cfg = { ...defaults(), segmentComments: true, segmentCount: 2, cooldownSeconds: 30, settleSeconds: 2, stateComments: false };
    const longText = '这首歌创作于 2003 年，是专辑《叶惠美》的主打之一，由周杰伦作曲，方文山作词，编曲以钢琴与弦乐为主。'.repeat(4);
    const comments = {
      get: async () => ({ status: 'ok', match: 'metadata',
        excerpts: Array.from({ length: 10 }, (_, i) => ({ text: `第 ${i + 1} 条评论：这段旋律让我想起学生时代的雨天，副歌进来时特别有画面感。`,
          kind: i < 6 ? 'hot' : 'recent', likes: 30 - i })),
        songBackground: { status: 'ok', source: '百度百科 + 歌曲百科', title: '晴天', text: longText,
          facts: [{ label: '所属专辑', value: '叶惠美' }, { label: '发行日期', value: '2003 年 7 月 31 日' }],
          wiki: { genres: ['流行'], tags: ['华语', '校园'], language: '国语', bpm: 68,
            awards: ['第 15 届金曲奖最佳作曲人'], appearances: [{ title: '不能说的秘密', year: 2007 }],
            review: { author: '乐评人', text: '一首把青春写进雨声里的歌。' },
            similar: [{ title: '七里香' }, { title: '简单爱' }], playlists: [{ title: '华语青春' }] } } }),
      getArtist: async () => ({ status: 'ok', artist: { id: 1, name: '周杰伦', aliases: ['Jay Chou'],
        bio: '华语流行歌手、作曲人，代表作横跨多个年代。'.repeat(10), musicSize: 300, albumSize: 15 },
        works: [{ title: '七里香', album: '七里香' }, { title: '稻香', album: '魔杰座' }],
        albums: [{ name: '叶惠美', year: 2003, company: '索尼' }],
        background: [{ source: '百度百科', kind: 'encyclopedia', text: '华语流行乐男歌手。'.repeat(8) },
          { source: 'Discogs', kind: 'community', text: 'Taiwanese singer-songwriter.'.repeat(8) }] }),
      lyrics: async () => ({ status: 'unavailable' }),
    };
    const world = new MusicWorld(cfg, () => {}, undefined, comments as any);
    const events: Array<Record<string, any>> = [];
    (world as any).host = {
      pushEvent: async (event: Record<string, any>) => { events.push(event); return { cursor: events.length }; },
      withdrawPending: async () => true,
    };
    const track = media({ timeline: false, positionSeconds: 0, durationSeconds: 200 });
    const t0 = fake;
    (world as any).observe({ track });
    fake = t0 + 5000;
    (world as any).observe({ track });
    // 断档会重新开始稳定计时：重新观察后再等 3 秒让曲目进入可评论状态。
    fake = t0 + 20_000;
    (world as any).observe({ track });
    fake = t0 + 23_000;
    (world as any).observe({ track });
    await (world as any).tick(fake);

    const openingEvent = events.filter(e => e.type === 'netease-music.comment_opportunity').at(-1);
    assert.ok(openingEvent, `events=${events.map(e => e.type).join(',')}`);
    const opening = JSON.parse(openingEvent.text);
    assert.equal(opening.phase, 'opening');
    for (const key of ['commentReference', 'artistContext', 'listeningProfile', 'profileSummary',
      'commentPreferences', 'listeningMemory', 'songNote']) assert.ok(key in opening, key);

    for (let i = 0; i < 25; ++i) { fake += 5000; (world as any).observe({ track }); }
    await (world as any).tick(fake);
    const snapshots = events.filter(e => e.type === 'netease-music.comment_opportunity');
    assert.equal(snapshots.length, 2);
    const segment = JSON.parse(snapshots.at(-1)!.text);
    assert.equal(segment.phase, 'segment');
    assert.equal(segment.reuse?.from, 'opening');
    for (const key of segment.reuse.omitted as string[]) {
      assert.equal(key in segment, false, key);
      assert.ok(segment.reuse.read[key], key);
    }
    const tools = world.tools().map(tool => tool.name);
    for (const tool of new Set(Object.values(segment.reuse.read) as string[])) assert.ok(tools.includes(tool), tool);
    // 被省略的字段都能用 reuse.read 指向的工具取回等价内容（同一份数据）。
    const call = async (name: string) => JSON.parse(String(await (world.tools().find(tool => tool.name === name)!.handler as any)({}, {})));
    const playing = await call('music_now_playing');
    for (const key of ['listeningProfile', 'profileSummary', 'listeningMemory', 'commentPreferences', 'songNote'])
      assert.ok(key in playing, key);
    const reference = await call('music_song_comments');
    assert.ok(Array.isArray(reference.excerpts) && reference.songBackground?.status === 'ok');
    const artist = await call('music_artist_context');
    assert.ok(artist.artist?.bio && artist.works?.length && artist.albums?.length && artist.background?.length);

    // 分段事件明显更小，但仍保留本次需要的段落、歌词、侧重与标签。
    assert.ok(JSON.stringify(segment).length < JSON.stringify(opening).length * 0.5);
    assert.ok((segment.segment?.positionSeconds ?? 0) >= 100);
    assert.ok(segment.commentFocus);
    assert.ok(segment.section);
    const cue = events.filter(e => e.type === 'netease-music.comment_requested').at(-1)!;
    assert.match(cue.text, /music_song_comments/);
    assert.match(cue.text, /music_artist_context/);
    assert.match(cue.text, /music_now_playing/);
  } finally {
    Date.now = realNow;
  }
});

test('World 在曲目稳定 10 秒后写入听歌记忆，并通过工具暴露关联', async () => {
  const dir = await temp();
  const realNow = Date.now;
  let fake = realNow();
  Date.now = () => fake;
  try {
    const world = new MusicWorld(defaults(), () => {}, undefined, undefined, dir);
    const call = async (name: string, args: Record<string, unknown> = {}) =>
      JSON.parse(String(await (world.tools().find(t => t.name === name)!.handler as any)(args, {})));
    const snapshot = () => ({ track: { title: '晴天', artist: '周杰伦', album: '叶惠美', app: 'cloudmusic', status: 'playing', method: 'smtc' } });
    (world as any).observe(snapshot());
    fake += LISTENING_DWELL_MS - 1000;
    (world as any).observe(snapshot());
    assert.equal((await call('music_listening_memory')).status, 'empty');
    fake += 2000;
    (world as any).observe(snapshot());
    await new Promise(resolve => setTimeout(resolve, 100));
    const memory = await call('music_listening_memory');
    assert.equal(memory.status, 'ok');
    assert.equal(memory.totalPlays, 1);
    assert.equal(memory.relation.track.count, 1);
    assert.equal(memory.relation.artist.name, '周杰伦');
    const now = await call('music_now_playing');
    assert.equal(now.listeningMemory.status, 'ok');
    assert.equal(now.listeningMemory.relation.track.count, 1);
    const snap = await world.webUi().invoke!('live-status', 'snapshot', []) as any;
    assert.match(snap.listening, /1 首/);
  } finally {
    Date.now = realNow;
    await rm(dir, { recursive: true, force: true });
  }
});
