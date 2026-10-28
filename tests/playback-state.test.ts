import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackStateTracker } from '../src/playback-state.ts';
import type { Track } from '../src/state.ts';

const track = (title: string, status: Track['status'] = 'playing'): Track => ({
  title, artist: '周杰伦', album: '叶惠美', app: 'cloudmusic', status, method: 'smtc',
});

test('暂停、恢复、结束各只提示一次', () => {
  const state = new PlaybackStateTracker();
  const a = track('晴天');
  assert.equal(state.update(a, 0), null);
  assert.equal(state.update({ ...a, status: 'paused' }, 1000), null);
  assert.deepEqual(state.update({ ...a, status: 'paused' }, 3000)?.kind, 'paused');
  assert.equal(state.update({ ...a, status: 'paused' }, 5000), null);
  assert.equal(state.update(a, 6000), null);
  assert.deepEqual(state.update(a, 7000)?.kind, 'resumed');
  assert.equal(state.update(a, 8000), null);
  assert.equal(state.update(null, 12000), null);
  assert.deepEqual(state.update(null, 13000)?.kind, 'ended');
  assert.equal(state.update(null, 14000), null);
});

test('初始暂停不补提示，恢复后才提示', () => {
  const state = new PlaybackStateTracker();
  const a = track('晴天', 'paused');
  assert.equal(state.update(a, 0), null);
  assert.equal(state.update(a, 5000), null);
  assert.equal(state.update({ ...a, status: 'playing' }, 6000), null);
  assert.deepEqual(state.update({ ...a, status: 'playing' }, 7000)?.kind, 'resumed');
});

test('换歌重置状态，不把新歌当成恢复或结束', () => {
  const state = new PlaybackStateTracker();
  assert.equal(state.update(track('晴天'), 0), null);
  assert.equal(state.update(track('起风了'), 1000), null);
  assert.equal(state.update(track('起风了'), 2000), null);
  assert.equal(state.update(null, 6000), null);
  assert.deepEqual(state.update(null, 7000)?.kind, 'ended');
});
