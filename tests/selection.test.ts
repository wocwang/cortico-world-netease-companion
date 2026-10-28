import test from 'node:test';
import assert from 'node:assert/strict';
import { TrackSelector } from '../src/selection.ts';
import type { SessionCandidate, WindowCandidate } from '../src/state.ts';

const priority = ['netease', 'qq', 'kugou', 'kuwo', 'spotify'];

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
