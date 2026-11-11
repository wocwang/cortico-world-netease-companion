import test from 'node:test';
import assert from 'node:assert/strict';
import { TrackSelector } from '../src/selection.ts';
import { autoPlayerId } from '../src/config.ts';
import { parseCandidates, type SessionCandidate, type WindowCandidate } from '../src/state.ts';

const priority = ['netease', 'qq', 'kugou', 'kuwo', 'spotify'];
const auto = { enabled: true, blacklist: [] as string[] };

const session = (player: string, over: Partial<SessionCandidate> = {}): SessionCandidate => ({
  app: `${player}.exe`, player, status: 'playing', title: '晴天', artist: '周杰伦', album: '叶惠美',
  timeline: true, positionSeconds: 12, durationSeconds: 269, ...over,
});

test('没有粘性时按优先级选择播放中的会话', () => {
  const selector = new TrackSelector();
  const picked = selector.select(priority, [session('qq'), session('netease', { app: 'cloudmusic.exe' })], []);
  assert.equal(picked?.player, 'netease');
  assert.equal(picked?.reason, 'priority-playing');
  assert.equal(picked?.track.timeline, true);
  assert.equal(picked?.track.positionSeconds, 12);
});

test('当前播放器仍在播放时，高优先级播放器需要连续出现才切换', () => {
  const selector = new TrackSelector(2);
  selector.select(priority, [session('qq')], []);
  const first = selector.select(priority, [session('qq'), session('netease')], []);
  assert.equal(first?.player, 'qq');
  assert.equal(first?.reason, 'sticky');
  assert.equal(selector.state().pending?.player, 'netease');
  const second = selector.select(priority, [session('qq'), session('netease')], []);
  assert.equal(second?.player, 'netease');
  assert.equal(second?.reason, 'priority-playing');
  assert.equal(selector.state().pending, undefined);
});

test('当前播放器暂停或消失时立即切换', () => {
  const selector = new TrackSelector(2);
  selector.select(priority, [session('qq')], []);
  const paused = selector.select(priority, [session('qq', { status: 'paused' }), session('netease')], []);
  assert.equal(paused?.player, 'netease');
  assert.equal(paused?.reason, 'priority-playing');

  const selector2 = new TrackSelector(2);
  selector2.select(priority, [session('qq')], []);
  const gone = selector2.select(priority, [session('netease')], []);
  assert.equal(gone?.player, 'netease');
});

test('同一播放器多个会话时保持已选中的应用', () => {
  const selector = new TrackSelector();
  selector.select(priority, [session('netease', { app: 'mini.exe' })], []);
  const picked = selector.select(priority, [
    session('netease', { app: 'cloudmusic.exe' }),
    session('netease', { app: 'mini.exe' }),
  ], []);
  assert.equal(picked?.app, 'mini.exe');
  assert.equal(picked?.reason, 'sticky');
});

test('通用识别：关闭时清单外会话不参与，打开后才接管', () => {
  const sessionList = [session(autoPlayerId('VutronMusic.exe'), { app: 'VutronMusic.exe' })];
  assert.equal(new TrackSelector().select(priority, sessionList, []), null);
  const picked = new TrackSelector().select(priority, sessionList, [], auto);
  assert.equal(picked?.player, 'auto:vutronmusic');
  assert.equal(picked?.reason, 'priority-playing');
});

test('通用识别：只有未知会话时暂停也作为兜底，有官方会话时按官方处理', () => {
  const paused = session(autoPlayerId('foo.exe'), { app: 'foo.exe', status: 'paused' });
  const picked = new TrackSelector().select(priority, [paused], [], auto);
  assert.equal(picked?.player, 'auto:foo');
  assert.equal(picked?.reason, 'priority-paused');
  const officialPaused = new TrackSelector().select(priority, [paused, session('qq', { status: 'paused' })], [], auto);
  assert.equal(officialPaused?.player, 'qq');
});

test('通用识别：官方或已保存的播放器在播时未知播放器不接管', () => {
  const unknown = session(autoPlayerId('foo.exe'), { app: 'foo.exe' });
  assert.equal(new TrackSelector().select(priority, [session('qq'), unknown], [], auto)?.player, 'qq');
  const saved = { enabled: true, blacklist: [] as string[], saved: ['auto:bar'] };
  const savedPlaying = session('auto:bar', { app: 'bar.exe' });
  assert.equal(new TrackSelector().select(priority, [savedPlaying, unknown], [], saved)?.player, 'auto:bar');
});

test('通用识别：保存后的未知播放器按已支持对待，暂停也参与并排在官方项之后', () => {
  const saved = { enabled: true, blacklist: [] as string[], saved: ['auto:foo'] };
  const foo = session('auto:foo', { app: 'foo.exe', status: 'paused' });
  const official = session('qq', { status: 'paused' });
  assert.equal(new TrackSelector().select(priority, [foo, official], [], saved)?.player, 'qq');
  assert.equal(new TrackSelector().select(priority, [foo], [], saved)?.player, 'auto:foo');
  // 保存项也不能压过正在播放的官方播放器。
  assert.equal(new TrackSelector().select(priority, [foo, session('qq')], [], saved)?.player, 'qq');
});

test('通用识别：黑名单关键词按完整片段匹配，不同发行版也能命中', () => {
  const teams = session(autoPlayerId('MSTeams_8wekyb3d8bbwe!MSTeams'), { app: 'MSTeams_8wekyb3d8bbwe!MSTeams' });
  const blocked = { enabled: true, blacklist: ['msteams'] };
  assert.equal(new TrackSelector().select(priority, [teams], [], blocked), null);
  // 关键词不能误伤包含它的其它产品：teams 不拦 MyTeamsPlayer，wecom 不拦 WeComic。
  const myTeams = session(autoPlayerId('MyTeamsPlayer.exe'), { app: 'MyTeamsPlayer.exe' });
  assert.notEqual(new TrackSelector().select(priority, [myTeams], [], { enabled: true, blacklist: ['teams'] }), null);
});

test('通用识别：播放中的未知播放器压过暂停的官方播放器，但压不过在播的官方播放器', () => {
  const known = session('qq', { status: 'paused' });
  const unknown = session(autoPlayerId('foo.exe'), { app: 'foo.exe' });
  const viaPaused = new TrackSelector().select(priority, [known, unknown], [], auto);
  assert.equal(viaPaused?.player, 'auto:foo');
  const viaPlaying = new TrackSelector().select(priority, [session('qq'), unknown], [], auto);
  assert.equal(viaPlaying?.player, 'qq');
});

test('通用识别：黑名单里的应用不参与', () => {
  const unknown = session(autoPlayerId('VutronMusic.exe'), { app: 'VutronMusic.exe' });
  const blocked = { enabled: true, blacklist: ['vutronmusic'] };
  assert.equal(new TrackSelector().select(priority, [unknown], [], blocked), null);
});

test('通用识别：已选中的未知播放器有粘性', () => {
  const selector = new TrackSelector(2);
  const unknown = session(autoPlayerId('foo.exe'), { app: 'foo.exe' });
  selector.select(priority, [unknown], [], auto);
  const kept = selector.select(priority, [unknown, session('qq', { status: 'paused' })], [], auto);
  assert.equal(kept?.player, 'auto:foo');
  assert.equal(kept?.reason, 'sticky');
});

test('通用识别：暂停后重新播放的未知播放器按最近一次开始播放排到前面', () => {
  const selector = new TrackSelector(1);
  const foo = session(autoPlayerId('foo.exe'), { app: 'foo.exe' });
  const bar = session(autoPlayerId('bar.exe'), { app: 'bar.exe' });
  assert.equal(selector.select(priority, [foo, bar], [], auto)?.player, 'auto:bar');
  // bar 继续在播、foo 暂停：保持 bar。
  assert.equal(selector.select(priority, [bar, { ...foo, status: 'paused' }], [], auto)?.player, 'auto:bar');
  // foo 重新开始播放，成为最近一次开始的未知播放器。
  assert.equal(selector.select(priority, [foo, bar], [], auto)?.player, 'auto:foo');
});

test('读取脚本标记 auto 的会话会折算成 auto:<短名>', () => {
  const parsed = parseCandidates({ sessions: [
    { app: 'VutronMusic.exe', player: '', auto: true, status: 'playing', title: '晴天' },
    { app: 'foo.exe', status: 'playing', title: '不认识的会话' },
  ] });
  assert.deepEqual(parsed.sessions.map(item => item.player), ['auto:vutronmusic']);
});

test('没有 SMTC 会话时按优先级选择窗口标题，并保持窗口来源', () => {
  const selector = new TrackSelector();
  const windows: WindowCandidate[] = [
    { player: 'qq', app: 'QQMusic', title: '晴天 - 周杰伦' },
    { player: 'netease', app: 'cloudmusic', title: '晴天 - 周杰伦' },
  ];
  const picked = selector.select(priority, [], windows);
  assert.equal(picked?.player, 'netease');
  assert.equal(picked?.reason, 'window-priority');
  assert.equal(picked?.track.method, 'window-title');
  assert.equal(picked?.track.timeline, false);
  const kept = selector.select(priority, [], [windows[1]]);
  assert.equal(kept?.reason, 'window-sticky');
});

const fullPriority = ['netease', 'qq', 'kugou', 'kuwo', 'spotify', 'apple'];
const unknown = session(autoPlayerId('foo.exe'), { app: 'foo.exe' });

// 1.20.0 的通用识别不得改变官方清单原有的优先级、粘性与窗口兜底。
for (const enabled of [false, true]) {
  const autoOptions = { enabled, blacklist: [] as string[] };
  test(`通用识别${enabled ? '开' : '关'}时六个官方播放器仍按优先级选择`, () => {
    const all = fullPriority.map(player => session(player));
    assert.equal(new TrackSelector().select(fullPriority, all, [], autoOptions)?.player, 'netease');
    assert.equal(new TrackSelector().select(fullPriority,
      [session('spotify'), session('kuwo'), unknown], [], autoOptions)?.player, 'kuwo');
    assert.equal(new TrackSelector().select(fullPriority,
      fullPriority.map(player => session(player, { status: 'paused' })), [], autoOptions)?.player, 'netease');
  });

  test(`通用识别${enabled ? '开' : '关'}时官方切换粘性与窗口兜底不变`, () => {
    const selector = new TrackSelector(2);
    selector.select(fullPriority, [session('qq')], [], autoOptions);
    // 未知播放器在播不影响官方粘性。
    assert.equal(selector.select(fullPriority, [session('qq'), session('netease'), unknown], [], autoOptions)?.player, 'qq');
    assert.equal(selector.select(fullPriority, [session('qq'), session('netease'), unknown], [], autoOptions)?.player, 'netease');
    const windows: WindowCandidate[] = [
      { player: 'spotify', app: 'Spotify', title: '晴天 - 周杰伦' },
      { player: 'netease', app: 'cloudmusic', title: '晴天 - 周杰伦' },
    ];
    const fresh = new TrackSelector().select(fullPriority, [], windows, autoOptions);
    assert.equal(fresh?.player, 'netease');
    assert.equal(fresh?.track.method, 'window-title');
  });
}

test('通用识别：多个未知会话时，最近一次开始播放的优先，暂停项不抢在播项', () => {
  const selector = new TrackSelector(1);
  const foo = session(autoPlayerId('foo.exe'), { app: 'foo.exe' });
  const bar = session(autoPlayerId('bar.exe'), { app: 'bar.exe' });
  const baz = session(autoPlayerId('baz.exe'), { app: 'baz.exe' });
  assert.equal(selector.select(priority, [foo, bar], [], auto)?.player, 'auto:bar');
  // 三个都在播：新出现的 baz 最近开始，排最前。
  assert.equal(selector.select(priority, [foo, bar, baz], [], auto)?.player, 'auto:baz');
  // baz 暂停后不抢仍在播放的 bar。
  assert.equal(selector.select(priority, [{ ...baz, status: 'paused' }, foo, bar], [], auto)?.player, 'auto:bar');
  // 只有未知会话且全部暂停时，取最近一次播放过的那一个作为兜底。
  const paused = selector.select(priority, [
    { ...foo, status: 'paused' }, { ...bar, status: 'paused' }, { ...baz, status: 'paused' },
  ], [], auto);
  assert.equal(paused?.player, 'auto:baz');
  assert.equal(paused?.reason, 'priority-paused');
});
