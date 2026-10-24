import test from 'node:test';
import assert from 'node:assert/strict';
import { MusicWorld } from '../src/world.ts';
import { defaults } from '../src/config.ts';

test('webUi 提供实时状态面板与快照', async () => {
  const world = new MusicWorld(defaults(), () => {});
  const web = world.webUi();
  assert.equal(web.badges, undefined);
  assert.equal(web.panels?.[0]?.id, 'live-status');
  assert.equal(web.panels?.[1]?.id, 'listening-ranking');
  const snap = await web.invoke?.('live-status', 'snapshot', []) as any;
  assert.equal(snap.reading, '等待网易云音乐（未打开或无曲目）');
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
  await assert.rejects(web.invoke!('live-status', 'other', []), /未知的状态请求/);
});
