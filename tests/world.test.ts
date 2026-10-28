import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MusicWorld } from '../src/world.ts';
import { configGroups, defaults } from '../src/config.ts';
import { parseSnapshot } from '../src/state.ts';

test('webUi 提供实时状态面板与快照', async () => {
  const world = new MusicWorld(defaults(), () => {});
  const web = world.webUi();
  assert.equal(web.badges, undefined);
  assert.equal(web.panels?.[0]?.id, 'live-status');
  assert.equal(web.panels?.[1]?.id, 'connection-check');
  assert.equal(web.panels?.[2]?.id, 'listening-ranking');
  assert.equal(web.panels?.[3]?.id, 'profile-analysis');
  assert.equal(web.panels?.[4]?.id, 'data-overview');
  assert.equal(web.panels?.[5]?.id, 'data-cleanup');
  assert.equal(web.panels?.[6]?.id, 'settings');
  assert.equal(web.config, undefined);
  assert.equal(web.storage, undefined);
  const snap = await web.invoke?.('live-status', 'snapshot', []) as any;
  assert.equal(snap.reading, '等待音乐播放器（未打开或无曲目）');
  assert.equal(snap.track, '无');
  assert.equal(snap.commentary, '开启');
  assert.equal(snap.comment, '尚未获取');
  assert.equal(snap.artist, '尚未获取');
  assert.equal(snap.preferences, '未启用');
  assert.equal(snap.interaction, '未启用');
  assert.equal(snap.listening, '未启用');
  assert.equal(snap.taste, '未启用');
  assert.equal(snap.requests, 0);
  assert.equal(snap.observedAt, null);
  const rank = await web.invoke?.('listening-ranking', 'snapshot', []) as any;
  assert.equal(rank.status, 'unavailable');
  assert.deepEqual(rank.tracks, []);
  const profile = await web.invoke?.('profile-analysis', 'snapshot', ['90']) as any;
  assert.equal(profile.status, 'unavailable');
  await assert.rejects(web.invoke!('profile-analysis', 'other', []), /未知的画像请求/);
  const overview = await web.invoke?.('data-overview', 'snapshot', []) as any;
  assert.equal(overview.status, 'unavailable');
  assert.deepEqual(overview.files, []);
  assert.equal(overview.totalBytes, 0);
  await assert.rejects(web.invoke!('data-overview', 'other', []), /未知的数据一览请求/);
  const cleanup = await web.invoke?.('data-cleanup', 'snapshot', []) as any;
  assert.equal(cleanup.status, 'unavailable');
  assert.equal((await web.invoke!('data-cleanup', 'preview', [30]) as any).status, 'unavailable');
  await assert.rejects(web.invoke!('data-cleanup', 'other', []), /未知的数据清理请求/);
  const settings = await web.invoke?.('settings', 'read', []) as any;
  assert.equal(settings.groups.length, configGroups.length);
  assert.equal(settings.groups[0].kind, 'commentary');
  assert.equal(settings.groups[0].fields.find((f: any) => f.key === 'cooldownSeconds').value, 120);
  assert.equal(settings.groups[0].fields.find((f: any) => f.key === 'announceTracks').value, true);
  assert.equal(settings.groups[0].fields.find((f: any) => f.key === 'segmentComments').value, false);
  assert.equal(settings.groups[0].fields.find((f: any) => f.key === 'segmentCount').value, 2);
  assert.equal(settings.groups[0].fields.find((f: any) => f.key === 'segmentEverySeconds').value, 60);
  assert.equal(settings.groups[0].fields.find((f: any) => f.key === 'actionHints').value, true);
  assert.equal(settings.groups[0].fields.find((f: any) => f.key === 'allowPlaybackControl').value, false);
  assert.equal(settings.groups[0].fields.find((f: any) => f.key === 'stateComments').value, true);
  assert.equal(
    settings.groups.reduce((sum: number, group: any) => sum + group.fields.length, 0),
    configGroups.reduce((sum, group) => sum + Object.keys(group.schema.properties).length, 0),
  );
  const reader = settings.groups.find((group: any) => group.kind === 'reader');
  assert.ok(reader.fields.every((field: any) => field.hot === false));
  await assert.rejects(web.invoke!('live-status', 'other', []), /未知的状态请求/);
  await assert.rejects(web.invoke!('connection-check', 'other', []), /未知的连接检查请求/);
  await assert.rejects(web.invoke!('settings', 'other', []), /未知的设置请求/);
});

test('设置面板直接持久化配置并校验范围', async () => {
  const cfg = defaults();
  const world = new MusicWorld(cfg, patch => Object.assign(cfg, patch));
  const web = world.webUi();
  assert.equal(web.config, undefined);
  await web.invoke!('settings', 'save', [{
    cooldownSeconds: 45, lyricsLines: 20.9, windowFallback: false,
    announceTracks: false, segmentComments: true, segmentCount: 3, segmentEverySeconds: 0,
    actionHints: false, allowPlaybackControl: true, stateComments: false,
    sessionPattern: 'cloudmusic|QQMusic', unknown: 1,
  }]);
  assert.equal(cfg.cooldownSeconds, 45);
  assert.equal(cfg.lyricsLines, 20);
  assert.equal(cfg.windowFallback, false);
  assert.equal(cfg.announceTracks, false);
  assert.equal(cfg.segmentComments, true);
  assert.equal(cfg.segmentCount, 3);
  assert.equal(cfg.segmentEverySeconds, 0);
  assert.equal(cfg.actionHints, false);
  assert.equal(cfg.allowPlaybackControl, true);
  assert.equal(cfg.stateComments, false);
  assert.equal(cfg.sessionPattern, 'cloudmusic|QQMusic');
  assert.equal((cfg as any).unknown, undefined);
  await assert.rejects(web.invoke!('settings', 'save', [{ cooldownSeconds: 5 }]), /不能小于/);
  await assert.rejects(web.invoke!('settings', 'save', [{ sessionPattern: '(' }]), /正则表达式无效/);
  await assert.rejects(web.invoke!('settings', 'save', [null]), /设置参数无效/);
});

test('单曲笔记、听感标签与多日历史通过工具读写', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'netease-world-memory-'));
  try {
    const world = new MusicWorld(defaults(), () => {}, undefined, undefined, dir);
    const track = { title: '晴天', artist: '周杰伦', album: '叶惠美', app: 'cloudmusic', status: 'playing' as const, method: 'smtc' as const };
    (world as any).state.current = track;
    (world as any).state.observedAt = Date.now();
    const tools = world.tools();
    const call = async (name: string, args: Record<string, unknown> = {}) =>
      JSON.parse(String(await (tools.find(tool => tool.name === name)!.handler as any)(args, {})));

    const note = await call('music_note', { text: '高中回忆' });
    assert.equal(note.status, 'ok');
    assert.equal((await call('music_now_playing')).songNote.text, '高中回忆');
    const tag = await call('music_tag', { feel: 'hard', genre: '摇滚' });
    assert.equal(tag.status, 'ok');
    assert.equal((await call('music_now_playing')).songTag.feel, 'hard');
    assert.equal((await call('music_history', { days: 1 })).status, 'empty');
    await (world as any).listening.record(track, Date.now());
    assert.equal((await call('music_history', { days: 1 })).totalPlays, 1);
    assert.equal((await call('music_taste', { days: 7 })).totalPlays, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('数据清理按保留天数删除旧记录并报告清理量', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'netease-world-cleanup-'));
  try {
    const world = new MusicWorld(defaults(), () => {}, undefined, undefined, dir);
    const store = (world as any).listening;
    const now = Date.now();
    await store.record({ title: '旧歌', artist: '旧歌手', album: '旧专辑', app: 'cloudmusic' }, now - 40 * 86_400_000);
    await store.record({ title: '旧歌', artist: '旧歌手', album: '旧专辑', app: 'cloudmusic' }, now - 40 * 86_400_000 + 1000);
    await store.record({ title: '晴天', artist: '周杰伦', album: '叶惠美', app: 'cloudmusic' }, now - 2 * 86_400_000);
    const web = world.webUi();
    const before = await web.invoke!('data-cleanup', 'snapshot', []) as any;
    assert.equal(before.status, 'ok');
    assert.equal(before.days, 2);
    assert.equal(before.plays, 3);
    assert.ok(before.oldest);
    const preview = await web.invoke!('data-cleanup', 'preview', [30]) as any;
    assert.equal(preview.status, 'ok');
    assert.equal(preview.removedDays, 1);
    assert.equal(preview.removedPlays, 2);
    assert.equal(preview.keptDays, 1);
    assert.equal(preview.keptPlays, 1);
    const all = await web.invoke!('data-cleanup', 'preview', [365]) as any;
    assert.equal(all.removedDays, 0);
    const overview = await web.invoke!('data-overview', 'snapshot', []) as any;
    assert.equal(overview.status, 'ok');
    assert.equal(overview.files.length, 5);
    assert.equal(overview.files.filter((file: any) => file.cleanup).length, 1);
    assert.equal(overview.files.find((file: any) => file.cleanup).key, 'listening');
    assert.ok(overview.totalBytes > 0);
    assert.ok(overview.files.find((file: any) => file.key === 'listening').bytes > 0);
    const result = await web.invoke!('data-cleanup', 'prune', [30]) as any;
    assert.equal(result.status, 'ok');
    assert.equal(result.removedDays, 1);
    assert.equal(result.removedPlays, 2);
    assert.equal(result.keptDays, 1);
    assert.equal(result.keptPlays, 1);
    const after = await web.invoke!('data-cleanup', 'snapshot', []) as any;
    assert.equal(after.days, 1);
    assert.equal(after.plays, 1);
    assert.equal(after.tracks, 1);
    const rank = await web.invoke!('listening-ranking', 'snapshot', []) as any;
    assert.deepEqual(rank.tracks.map((item: any) => item.title), ['晴天']);
    assert.equal(rank.tracks[0].count, 1);
    const nothing = await web.invoke!('data-cleanup', 'prune', [30]) as any;
    assert.equal(nothing.removedDays, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('老版本只有累计排名时，个人画像用累计数据兜底而不是从零开始', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'netease-world-cumulative-'));
  try {
    const at = '2026-10-20T10:00:00.000Z';
    await writeFile(join(dir, 'listening.json'), JSON.stringify({
      version: 1, totalPlays: 7,
      tracks: [
        { title: '晴天', artist: '周杰伦', album: '叶惠美', count: 5, firstAt: at, lastAt: at },
        { title: '起风了', artist: '买辣椒也用券', album: '起风了', count: 2, firstAt: at, lastAt: at },
      ],
      artists: [
        { name: '周杰伦', count: 5, lastAt: at },
        { name: '买辣椒也用券', count: 2, lastAt: at },
      ],
    }), 'utf8');
    const world = new MusicWorld(defaults(), () => {}, undefined, undefined, dir);
    const web = world.webUi();
    const profile = await web.invoke!('profile-analysis', 'snapshot', ['90']) as any;
    assert.equal(profile.status, 'ok');
    assert.equal(profile.scope, 'cumulative');
    assert.equal(profile.totalPlays, 7);
    assert.equal(profile.recordedDays, 0);
    assert.equal(profile.topArtists[0].name, '周杰伦');
    assert.deepEqual(profile.repeatTracks.map((item: any) => item.title), ['晴天', '起风了']);
    assert.deepEqual(profile.daily, []);
    assert.deepEqual(profile.players, []);
    const taste = JSON.parse(String(await (world.tools().find(tool => tool.name === 'music_taste')!.handler as any)(
      { days: 7 }, {})));
    assert.equal(taste.status, 'ok');
    assert.equal(taste.scope, 'cumulative');
    assert.equal(taste.totalPlays, 7);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('新增播放控制与搜歌工具，默认不执行控制', async () => {
  const world = new MusicWorld(defaults(), () => {});
  const tools = world.tools();
  assert.ok(tools.some(tool => tool.name === 'music_control'));
  assert.ok(tools.some(tool => tool.name === 'music_pick'));
  const control = tools.find(tool => tool.name === 'music_control')!;
  const disabled = JSON.parse(String(await (control.handler as any)({ action: 'pause' }, {})));
  assert.equal(disabled.status, 'disabled');
  await assert.rejects((control.handler as any)({ action: 'stop' }, {}), /action/);
  const pick = tools.find(tool => tool.name === 'music_pick')!;
  await assert.rejects((pick.handler as any)({ query: '' }, {}), /query/);
  const vars = world.envPromptVars();
  assert.equal(vars['music.segmentCount'], '2');
  assert.equal(vars['music.actionHints'], '开启');
  assert.equal(vars['music.controlAllowed'], '关闭');
  assert.equal(typeof vars['music.actionVocab'], 'string');
});

test('解析媒体快照时保留播放位置与曲目时长', () => {
  const snap = parseSnapshot({ track: {
    title: '晴天', artist: '周杰伦', album: '叶惠美', app: 'cloudmusic',
    status: 'playing', method: 'smtc', positionSeconds: 12, durationSeconds: 269,
  } });
  assert.equal(snap.track?.positionSeconds, 12);
  assert.equal(snap.track?.durationSeconds, 269);
});

test('配置分组明确支持网易云与 QQ 音乐，功能标签不带平台名', () => {
  assert.equal(new Set(configGroups.map(group => group.id)).size, configGroups.length);
  assert.ok(configGroups.length >= 5);
  for (const group of configGroups) {
    assert.equal(group.owner, 'world:netease-music');
    assert.ok(group.schema.title);
    assert.ok(group.schema.description);
  }
  const descriptions = configGroups.map(group => group.schema.description).join(' ');
  assert.match(descriptions, /网易云音乐与 QQ 音乐/);
  const props = Object.assign({}, ...configGroups.map(group => group.schema.properties)) as any;
  assert.equal(props['worlds.netease-music.commentReference'].title, '参考评论区（联网）');
  assert.doesNotMatch(props['worlds.netease-music.commentReference'].title, /网易云/);
  assert.doesNotMatch(props['worlds.netease-music.artistContext'].description, /网易云/);
  assert.doesNotMatch(props['worlds.netease-music.songContext'].description, /网易云/);
  assert.match(props['worlds.netease-music.sessionPattern'].title, /网易云音乐 \/ QQ 音乐/);
  assert.equal(props['worlds.netease-music.sessionPattern']['x-hot'], false);
});
