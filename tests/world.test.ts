import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MusicWorld } from '../src/world.ts';
import {
  autoLabel, autoPlayerId, configGroups, customPlayerIds, defaults, DEFAULT_AUTO_BLACKLIST, isAutoPlayer,
  isBlacklistedApp, isInternationalPlayer, matchPlayer, parseAutoBlacklist, parseCustomPlayers, PLAYERS, playerOrder,
} from '../src/config.ts';
import { parseCandidates, parseSnapshot, type Track } from '../src/state.ts';
import { TrackSelector } from '../src/selection.ts';

test('评论与状态提示要求语音 World 同步发声', () => {
  const world = new MusicWorld(defaults(), () => {});
  assert.match((world as any).voiceHint(), /sovits_speak/);
  assert.match((world as any).stateCueText({ kind: 'paused', track: null }), /sovits_speak/);
});

test('安静时段跨零点生效，用户主动对话不受影响', () => {
  const world = new MusicWorld({ ...defaults(), quietHours: true, quietStart: 23, quietEnd: 7 }, () => {});
  const at = (hour: number, minute = 0) => new Date(2026, 9, 29, hour, minute).getTime();
  assert.equal((world as any).quietNow(at(23, 30)), true);
  assert.equal((world as any).quietNow(at(3)), true);
  assert.equal((world as any).quietNow(at(6, 59)), true);
  assert.equal((world as any).quietNow(at(7)), false);
  assert.equal((world as any).quietNow(at(22, 59)), false);
});

test('webUi 提供实时状态面板与快照', async () => {
  const world = new MusicWorld(defaults(), () => {});
  const web = world.webUi();
  assert.equal(web.badges, undefined);
  assert.equal(web.panels?.[0]?.id, 'live-status');
  assert.equal(web.panels?.[1]?.id, 'connection-check');
  assert.equal(web.panels?.[2]?.id, 'reader-diagnostics');
  assert.equal(web.panels?.[3]?.id, 'listening-ranking');
  assert.equal(web.panels?.[4]?.id, 'profile-analysis');
  assert.equal(web.panels?.[5]?.id, 'data-overview');
  assert.equal(web.panels?.[6]?.id, 'data-cleanup');
  assert.equal(web.panels?.[7]?.id, 'settings');
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
  assert.deepEqual(reader.fields.map((field: any) => field.key), ['playerPriority', 'windowFallback', 'autoDetect', 'autoBlacklist']);
  assert.deepEqual(reader.players.map((player: any) => player.id), ['netease', 'qq', 'kugou', 'kuwo', 'spotify', 'apple']);
  assert.equal(reader.fields[0].value.join(','), 'netease,qq,kugou,kuwo,spotify,apple');
  const diagnostics = await web.invoke!('reader-diagnostics', 'snapshot', []) as any;
  assert.equal(diagnostics.status, 'ok');
  assert.deepEqual(diagnostics.priority.map((item: any) => item.id), ['netease', 'qq', 'kugou', 'kuwo', 'spotify', 'apple']);
  assert.equal(diagnostics.current, null);
  assert.equal(diagnostics.reader.running, false);
  assert.deepEqual(diagnostics.reader.sessions, []);
  assert.equal((await web.invoke!('reader-diagnostics', 'restart', []) as any).status, 'unavailable');
  await assert.rejects(web.invoke!('live-status', 'other', []), /未知的状态请求/);
  await assert.rejects(web.invoke!('connection-check', 'other', []), /未知的连接检查请求/);
  await assert.rejects(web.invoke!('reader-diagnostics', 'other', []), /未知的读取诊断请求/);
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
    playerPriority: ['spotify', 'netease', 'spotify', 'unknown'], unknown: 1,
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
  assert.deepEqual(cfg.playerPriority, ['spotify', 'netease', 'qq', 'kugou', 'kuwo', 'apple']);
  assert.equal((cfg as any).unknown, undefined);
  await assert.rejects(web.invoke!('settings', 'save', [{ cooldownSeconds: 5 }]), /不能小于/);
  await assert.rejects(web.invoke!('settings', 'save', [{ playerPriority: 'netease' }]), /不是有效列表/);
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
    assert.equal(overview.files.length, 7);
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

test('已有逐日记录时仍保留更新前的累计排名', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'netease-world-mixed-'));
  try {
    const at = '2026-10-28T10:00:00.000Z';
    await writeFile(join(dir, 'listening.json'), JSON.stringify({
      version: 2, totalPlays: 9,
      tracks: [
        { title: '晴天', artist: '周杰伦', album: '叶惠美', count: 6, firstAt: at, lastAt: at },
        { title: '起风了', artist: '买辣椒也用券', album: '起风了', count: 2, firstAt: at, lastAt: at },
        { title: '童年', artist: '罗大佑', album: '', count: 1, firstAt: at, lastAt: at },
      ],
      artists: [
        { name: '周杰伦', count: 6, lastAt: at },
        { name: '买辣椒也用券', count: 2, lastAt: at },
        { name: '罗大佑', count: 1, lastAt: at },
      ],
      days: [{
        date: '2026-10-28', plays: 5,
        tracks: [
          { title: '晴天', artist: '周杰伦', album: '叶惠美', count: 4, lastAt: at },
          { title: '起风了', artist: '买辣椒也用券', album: '起风了', count: 1, lastAt: at },
        ],
        artists: [
          { name: '周杰伦', count: 4, lastAt: at },
          { name: '买辣椒也用券', count: 1, lastAt: at },
        ],
        hours: Array(24).fill(0).map((_, hour) => hour === 10 ? 4 : hour === 11 ? 1 : 0),
        players: [{ app: 'cloudmusic', count: 4 }, { app: 'QQMusic', count: 1 }],
      }],
    }), 'utf8');
    const world = new MusicWorld(defaults(), () => {}, undefined, undefined, dir);
    const web = world.webUi();
    const profile = await web.invoke!('profile-analysis', 'snapshot', ['90']) as any;
    assert.equal(profile.status, 'ok');
    assert.equal(profile.scope, 'mixed');
    assert.equal(profile.totalPlays, 9);
    assert.equal(profile.earlierPlays, 4);
    assert.equal(profile.recordedDays, 1);
    assert.equal(profile.topArtists[0].name, '周杰伦');
    assert.equal(profile.topArtists[0].count, 6);
    assert.deepEqual(profile.repeatTracks.map((item: any) => item.title), ['晴天', '起风了']);
    assert.equal(profile.hours.find((item: any) => item.hour === 10)?.count, 4);
    assert.equal(profile.players[0].count, 4);
    assert.match(profile.summary, /9 次播放/);
    assert.match(profile.summary, /4 次来自更新前/);
    const calendar = await web.invoke!('profile-analysis', 'calendar', ['2026-10']) as any;
    assert.equal(calendar.status, 'ok');
    assert.equal(calendar.days.length, 1);
    assert.equal(calendar.days[0].date, '2026-10-28');
    const day = await web.invoke!('profile-analysis', 'day', ['2026-10-28']) as any;
    assert.equal(day.status, 'ok');
    assert.equal(day.tracks.length, 2);
    assert.deepEqual(profile.playerBreakdown.map((item: any) => item.app), ['cloudmusic', 'QQMusic']);
    assert.equal(profile.playerBreakdown[0].plays, 4);
    const taste = JSON.parse(String(await (world.tools().find(tool => tool.name === 'music_taste')!.handler as any)(
      { days: 7 }, {})));
    assert.equal(taste.status, 'ok');
    assert.equal(taste.scope, 'mixed');
    assert.equal(taste.totalPlays, 9);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('新增播放控制与搜歌工具，默认不执行控制', async () => {
  const world = new MusicWorld(defaults(), () => {});
  const tools = world.tools();
  assert.ok(tools.some(tool => tool.name === 'music_control'));
  assert.ok(tools.some(tool => tool.name === 'music_pick'));
  assert.ok(tools.some(tool => tool.name === 'music_soul'));
  const control = tools.find(tool => tool.name === 'music_control')!;
  const disabled = JSON.parse(String(await (control.handler as any)({ action: 'pause' }, {})));
  assert.equal(disabled.status, 'disabled');
  await assert.rejects((control.handler as any)({ action: 'stop' }, {}), /action/);
  const pick = tools.find(tool => tool.name === 'music_pick')!;
  // 没有记忆目录时想听清单不可用：空 query 不再报错，而是如实返回 unavailable。
  const noQuery = JSON.parse(String(await (pick.handler as any)({ query: '' }, {})));
  assert.equal(noQuery.status, 'unavailable');
  const soul = tools.find(tool => tool.name === 'music_soul')!;
  const soulDisabled = JSON.parse(String(await (soul.handler as any)({ action: 'read' }, {})));
  assert.equal(soulDisabled.status, 'unavailable');
  const vars = world.envPromptVars();
  assert.equal(vars['music.segmentCount'], '2');
  assert.equal(vars['music.actionHints'], '开启');
  assert.equal(vars['music.controlAllowed'], '关闭');
  assert.equal(typeof vars['music.actionHints'], 'string');
  // 动作词表改由桌宠自己的环境提示词提供，World 不再读取形象文件。
  assert.equal(vars['music.actionVocab'], undefined);
});

test('解析媒体快照时保留播放位置、曲目时长与播放器能力', () => {
  const snap = parseSnapshot({ track: {
    title: '晴天', artist: '周杰伦', album: '叶惠美', app: 'cloudmusic', player: 'netease', timeline: true,
    status: 'playing', method: 'smtc', positionSeconds: 12, durationSeconds: 269,
  } });
  assert.equal(snap.track?.positionSeconds, 12);
  assert.equal(snap.track?.durationSeconds, 269);
  assert.equal(snap.track?.player, 'netease');
  assert.equal(snap.track?.timeline, true);
  const fallback = parseSnapshot({ track: {
    title: '晴天 - 周杰伦', artist: '', album: '', app: 'KuGou', player: 'kugou', timeline: false,
    status: 'unknown', method: 'window-title',
  } });
  assert.equal(fallback.track?.timeline, false);
  assert.equal(fallback.track?.player, 'kugou');
});

test('解析读取候选并过滤无效项', () => {
  const parsed = parseCandidates({
    sessions: [
      { app: 'QQMusic.exe', player: 'qq', status: 'playing', title: '晴天', artist: '周杰伦',
        album: '叶惠美', timeline: true, positionSeconds: 3, durationSeconds: 269 },
      { app: '', player: 'qq', status: 'playing', title: '', timeline: false },
      { app: 'KuGou.exe', player: 'kugou', status: 'paused', title: '起风了', timeline: false },
    ],
    windowCandidates: [
      { app: 'cloudmusic', player: 'netease', title: '晴天 - 周杰伦' },
      { app: 'cloudmusic', player: 'netease' },
    ],
    error: '示例错误',
  });
  assert.equal(parsed.sessions.length, 2);
  assert.equal(parsed.sessions[0].timeline, true);
  assert.equal(parsed.sessions[0].positionSeconds, 3);
  assert.equal(parsed.sessions[1].status, 'paused');
  assert.equal(parsed.windows.length, 1);
  assert.equal(parsed.error, '示例错误');
});

test('官方播放器清单、优先级归一化与匹配', () => {
  assert.deepEqual(PLAYERS.map(player => player.id), ['netease', 'qq', 'kugou', 'kuwo', 'spotify', 'apple']);
  assert.deepEqual(playerOrder(undefined), ['netease', 'qq', 'kugou', 'kuwo', 'spotify', 'apple']);
  assert.deepEqual(playerOrder(['spotify', 'qq', 'spotify', 'unknown']), ['spotify', 'qq', 'netease', 'kugou', 'kuwo', 'apple']);
  // 已保存的播放器进入优先级：保留用户排的位置，旧配置缺项补末尾，删除后不留残项。
  const custom = 'auto:vutronmusic';
  assert.deepEqual(playerOrder(['netease', custom, 'qq'], [custom]),
    ['netease', custom, 'qq', 'kugou', 'kuwo', 'spotify', 'apple']);
  assert.deepEqual(playerOrder(['netease', 'qq'], [custom]),
    ['netease', 'qq', 'kugou', 'kuwo', 'spotify', 'apple', custom]);
  assert.deepEqual(playerOrder([custom, 'netease', 'qq'], []),
    ['netease', 'qq', 'kugou', 'kuwo', 'spotify', 'apple']);
  assert.equal(matchPlayer('Spotify.exe')?.id, 'spotify');
  assert.equal(matchPlayer('SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify')?.id, 'spotify');
  assert.equal(matchPlayer('AppleInc.AppleMusicWin_nzyj5cx40ttqa!App')?.id, 'apple');
  assert.equal(matchPlayer('AppleMusic.exe')?.id, 'apple');
  // 通用识别：清单外的应用折算成 auto:<短名>，展示名取 exe 名或 MSIX 包名。
  assert.equal(autoPlayerId('VutronMusic.exe'), 'auto:vutronmusic');
  assert.equal(autoPlayerId('foo.bar.exe'), 'auto:foo-bar');
  assert.equal(isAutoPlayer('auto:foo'), true);
  assert.equal(isAutoPlayer('qq'), false);
  assert.equal(autoLabel('VutronMusic.exe'), 'VutronMusic');
  assert.equal(autoLabel('Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic'), 'Microsoft.ZuneMusic');
  // 国际曲库标记不再靠枚举播放器 id。
  assert.equal(isInternationalPlayer('spotify'), true);
  assert.equal(isInternationalPlayer('apple'), true);
  assert.equal(isInternationalPlayer('netease'), false);
  assert.equal(isInternationalPlayer('auto:foo'), false);
  assert.deepEqual(parseAutoBlacklist(' Foo.exe, auto:bar\nbaz；qux '), ['foo.exe', 'auto:bar', 'baz', 'qux']);
  assert.equal(isBlacklistedApp('VutronMusic.exe', ['vutronmusic']), true);
  assert.equal(isBlacklistedApp('VutronMusic.exe', ['auto:vutronmusic']), true);
  assert.equal(isBlacklistedApp('VutronMusic.exe', ['other']), false);
  // 默认黑名单用关键词覆盖不同发行版的会议/办公软件；关键词按完整片段匹配。
  assert.match(DEFAULT_AUTO_BLACKLIST, /teams/);
  assert.equal(isBlacklistedApp('MSTeams_8wekyb3d8bbwe!MSTeams', parseAutoBlacklist(DEFAULT_AUTO_BLACKLIST)), true);
  assert.equal(isBlacklistedApp('MSTeams_8wekyb3d8bbwe!MSTeams', ['teams']), false);
  assert.equal(isBlacklistedApp('Teams.exe', ['teams']), true);
  assert.equal(isBlacklistedApp('Zoom.exe', ['zoom']), true);
  // 关键词是其完整片段才命中；默认清单写的是完整产品名，缩写不会误伤也不会漏拦。
  assert.equal(isBlacklistedApp('wemeetapp.exe', ['wemeetapp']), true);
  assert.equal(isBlacklistedApp('wemeetapp.exe', ['wemeet']), false);
  // 不误伤包含关键词的其它产品。
  assert.equal(isBlacklistedApp('MyTeamsPlayer.exe', ['teams']), false);
  assert.equal(isBlacklistedApp('WeComic.exe', ['wecom']), false);
  // 默认黑名单只含会议/办公类，浏览器与编辑器不会被静默排除。
  const defaultsList = parseAutoBlacklist(DEFAULT_AUTO_BLACKLIST);
  assert.equal(isBlacklistedApp('msedge.exe', defaultsList), false);
  assert.equal(isBlacklistedApp('ByteDance.TraeCN_zp6j6v1nqm6jc!TraeCN', defaultsList), false);
  // 保存的播放器去重、保序，并折算成 auto:<短名>。
  assert.deepEqual(parseCustomPlayers(['foo.exe', ' FOO.exe ', '', null, 'bar.exe']), ['foo.exe', 'bar.exe']);
  assert.deepEqual(customPlayerIds(['foo.exe', 'bar.exe']), ['auto:foo', 'auto:bar']);
  assert.equal(matchPlayer('KuGou.exe')?.id, 'kugou');
  assert.equal(matchPlayer('KwMusic.exe')?.id, 'kuwo');
  assert.equal(matchPlayer('QQMusic.exe')?.id, 'qq');
  assert.equal(matchPlayer('chrome.exe'), null);
});

test('连接检查保存/取消保存未知播放器并解除同名黑名单', () => {
  const cfg = defaults();
  cfg.autoBlacklist = 'vutronmusic, msteams, teams';
  const world = new MusicWorld(cfg, patch => Object.assign(cfg, patch));
  (world as any).saveCustomPlayer('VutronMusic.exe');
  assert.deepEqual(cfg.customPlayers, ['VutronMusic.exe']);
  assert.equal(cfg.autoBlacklist, 'msteams, teams');
  assert.equal(cfg.playerPriority.at(-1), 'auto:vutronmusic');
  (world as any).saveCustomPlayer('VutronMusic.exe');
  assert.deepEqual(cfg.customPlayers, ['VutronMusic.exe']);
  (world as any).forgetCustomPlayer('VutronMusic.exe');
  assert.deepEqual(cfg.customPlayers, []);
  // 取消保存只清支持列表与优先级，不写黑名单。
  assert.ok(!cfg.playerPriority.includes('auto:vutronmusic'));
  assert.equal(cfg.playerPriority.length, 6);
  assert.equal(cfg.autoBlacklist, 'msteams, teams');
  // 回到普通未知播放器：没有已知项在播时，按通用识别照常参与。
  assert.equal(new TrackSelector().select(cfg.playerPriority, [{
    app: 'VutronMusic.exe', player: 'auto:vutronmusic', status: 'playing',
    title: '晴天', artist: '', album: '', timeline: false,
  }], [], {
    enabled: true, blacklist: parseAutoBlacklist(cfg.autoBlacklist), saved: customPlayerIds(cfg.customPlayers),
  })?.player, 'auto:vutronmusic');
  // 一键移出只删除能匹配到该应用的词，别的黑名单项保留。
  (world as any).unblockCustomPlayer('MSTeams_8wekyb3d8bbwe!MSTeams');
  assert.equal(cfg.autoBlacklist, 'teams');
});

test('设置里的播放器优先级包含已保存项，调整顺序后实际选择随之变化', async () => {
  const id = 'auto:vutronmusic';
  const cfg = {
    ...defaults(),
    customPlayers: ['VutronMusic.exe'],
    playerPriority: ['netease', 'qq', 'kugou', 'kuwo', 'spotify', 'apple', id],
  };
  const world = new MusicWorld(cfg, patch => Object.assign(cfg, patch));
  const web = world.webUi();
  const settings = await web.invoke!('settings', 'read', []) as any;
  const reader = settings.groups.find((group: any) => group.kind === 'reader');
  assert.deepEqual(reader.players.map((player: any) => player.id), ['netease', 'qq', 'kugou', 'kuwo', 'spotify', 'apple', id]);
  assert.equal(reader.players.at(-1).custom, true);
  assert.equal(reader.players.at(-1).app, 'VutronMusic.exe');

  const sessions = [
    { app: 'VutronMusic.exe', player: id, status: 'playing' as const, title: '晴天', artist: '', album: '', timeline: false },
    { app: 'cloudmusic.exe', player: 'netease', status: 'playing' as const, title: '晴天', artist: '', album: '', timeline: false },
  ];
  const pick = () => new TrackSelector().select(cfg.playerPriority, sessions, [], {
    enabled: true, blacklist: [], saved: customPlayerIds(cfg.customPlayers),
  })?.player;
  assert.equal(pick(), 'netease');
  // 把保存项拖到最前，选择结果立即跟着变。
  await web.invoke!('settings', 'save', [{ playerPriority: [id, 'netease', 'qq', 'kugou', 'kuwo', 'spotify', 'apple'] }]);
  assert.equal(cfg.playerPriority[0], id);
  assert.equal(pick(), id);
  // 官方项仍然一个不少，只调整相对顺序。
  await web.invoke!('settings', 'save', [{ playerPriority: ['qq'] }]);
  assert.deepEqual(cfg.playerPriority, ['qq', 'netease', 'kugou', 'kuwo', 'spotify', 'apple', id]);
});

test('连接检查：保存项持久化、去重，最多 20 个', () => {
  const cfg = defaults();
  const persisted: any[] = [];
  const world = new MusicWorld(cfg, patch => { persisted.push(patch); Object.assign(cfg, patch); });
  for (let i = 0; i < 20; i++) (world as any).saveCustomPlayer(`Player${i}.exe`);
  assert.equal(cfg.customPlayers.length, 20);
  assert.deepEqual(cfg.customPlayers.slice(0, 2), ['Player0.exe', 'Player1.exe']);
  // 重复保存不占新名额，也不报错。
  assert.doesNotThrow(() => (world as any).saveCustomPlayer('Player0.exe'));
  assert.equal(cfg.customPlayers.length, 20);
  assert.throws(() => (world as any).saveCustomPlayer('Overflow.exe'), /最多保存 20 个/);
  assert.equal(cfg.customPlayers.length, 20);
  // 新配置对象（模拟重启）仍能读回保存项。
  const restored = new MusicWorld({ ...cfg }, () => {});
  assert.deepEqual((restored as any).cfg.customPlayers, cfg.customPlayers);
  assert.deepEqual(customPlayerIds(cfg.customPlayers).slice(0, 1), ['auto:player0']);
  assert.ok(persisted.some(patch => Array.isArray(patch.customPlayers)));
});

test('连接检查：移出黑名单后该应用立即恢复参与选择', () => {
  const app = 'MyTeamsPlayer.exe';
  const cfg = { ...defaults(), autoBlacklist: 'myteamsplayer, zoom' };
  const world = new MusicWorld(cfg, patch => Object.assign(cfg, patch));
  const blocked = new TrackSelector().select(['netease', 'qq'], [
    { app, player: 'auto:myteamsplayer', status: 'playing', title: '晴天', artist: '', album: '', timeline: false },
  ], [], { enabled: true, blacklist: parseAutoBlacklist(cfg.autoBlacklist) });
  assert.equal(blocked, null);
  const result = (world as any).unblockCustomPlayer(app) as { autoBlacklist: string };
  assert.equal(result.autoBlacklist, 'zoom');
  const picked = new TrackSelector().select(['netease', 'qq'], [
    { app, player: 'auto:myteamsplayer', status: 'playing', title: '晴天', artist: '', album: '', timeline: false },
  ], [], { enabled: true, blacklist: parseAutoBlacklist(cfg.autoBlacklist) });
  assert.equal(picked?.player, 'auto:myteamsplayer');
});

test('重启后同一首还在放不会补一次开场评论，换歌后照常评论并更新标记', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'netease-world-resume-'));
  try {
    const t0 = Date.now();
    const world = new MusicWorld(defaults(), () => {}, undefined, {
      get: async () => ({ status: 'disabled' }),
      getArtist: async () => ({ status: 'unavailable' }),
    }, dir);
    (world as any).abort = new AbortController();
    const track: Track = { title: '晴天', artist: '周杰伦', album: '叶惠美', app: 'cloudmusic', player: 'netease', status: 'playing', method: 'smtc' };
    (world as any).rememberLastComment(track, t0 - 60_000);
    (world as any).readLastComment();
    const events: Array<Record<string, any>> = [];
    (world as any).host = { pushEvent: async (event: Record<string, any>) => { events.push(event); return { cursor: events.length }; } };
    (world as any).observe({ track });
    await (world as any).tick(t0 + 9000);
    assert.equal(events.length, 0);
    const next: Track = { ...track, title: '起风了', artist: '买辣椒也用券', album: '起风了' };
    (world as any).observe({ track: next });
    await (world as any).tick(Date.now() + 9000);
    assert.equal(events.length, 2);
    assert.equal(events[1].type, 'netease-music.comment_requested');
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'last-comment.json'), 'utf8')).track,
      { title: '起风了', artist: '买辣椒也用券', album: '起风了' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('配置分组只暴露官方播放器优先级与通用识别，功能标签不带平台名', () => {
  assert.equal(new Set(configGroups.map(group => group.id)).size, configGroups.length);
  assert.ok(configGroups.length >= 5);
  for (const group of configGroups) {
    assert.equal(group.owner, 'world:netease-music');
    assert.ok(group.schema.title);
    assert.ok(group.schema.description);
  }
  const descriptions = configGroups.map(group => group.schema.description).join(' ');
  assert.match(descriptions, /官方播放器按优先级读取/);
  assert.match(descriptions, /通用识别/);
  const props = Object.assign({}, ...configGroups.map(group => group.schema.properties)) as any;
  assert.equal(props['worlds.netease-music.commentReference'].title, '参考评论区（联网）');
  assert.doesNotMatch(props['worlds.netease-music.commentReference'].title, /网易云/);
  assert.doesNotMatch(props['worlds.netease-music.artistContext'].description, /网易云/);
  assert.doesNotMatch(props['worlds.netease-music.songContext'].description, /网易云/);
  assert.equal(props['worlds.netease-music.playerPriority'].type, 'array');
  assert.equal(props['worlds.netease-music.playerPriority']['x-hot'], false);
  assert.equal(props['worlds.netease-music.autoDetect'].type, 'boolean');
  assert.equal(props['worlds.netease-music.autoBlacklist'].type, 'string');
  assert.equal(props['worlds.netease-music.sessionPattern'], undefined);
  assert.equal(props['worlds.netease-music.windowFallbackProcess'], undefined);
});
