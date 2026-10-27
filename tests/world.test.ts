import test from 'node:test';
import assert from 'node:assert/strict';
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
  assert.equal(web.panels?.[3]?.id, 'settings');
  assert.equal(web.config, undefined);
  const snap = await web.invoke?.('live-status', 'snapshot', []) as any;
  assert.equal(snap.reading, '等待音乐播放器（未打开或无曲目）');
  assert.equal(snap.track, '无');
  assert.equal(snap.commentary, '开启');
  assert.equal(snap.comment, '尚未获取');
  assert.equal(snap.artist, '尚未获取');
  assert.equal(snap.preferences, '未启用');
  assert.equal(snap.interaction, '未启用');
  assert.equal(snap.listening, '未启用');
  assert.equal(snap.requests, 0);
  assert.equal(snap.observedAt, null);
  const rank = await web.invoke?.('listening-ranking', 'snapshot', []) as any;
  assert.equal(rank.status, 'unavailable');
  assert.deepEqual(rank.tracks, []);
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
    actionHints: false, allowPlaybackControl: true,
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
  assert.equal(cfg.sessionPattern, 'cloudmusic|QQMusic');
  assert.equal((cfg as any).unknown, undefined);
  await assert.rejects(web.invoke!('settings', 'save', [{ cooldownSeconds: 5 }]), /不能小于/);
  await assert.rejects(web.invoke!('settings', 'save', [{ sessionPattern: '(' }]), /正则表达式无效/);
  await assert.rejects(web.invoke!('settings', 'save', [null]), /设置参数无效/);
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
