import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionOf } from '../src/phase.ts';
import type { Track } from '../src/state.ts';

const track = (positionSeconds: number, durationSeconds: number): Track => ({
  title: '晴天', artist: '周杰伦', album: '叶惠美', app: 'cloudmusic',
  status: 'playing', method: 'smtc', positionSeconds, durationSeconds,
});

test('按播放比例给出段落，并明确标为估算', () => {
  assert.deepEqual(sectionOf(track(10, 200)), { id: 'intro', label: '开场', estimated: true });
  assert.equal(sectionOf(track(60, 200))?.label, '主歌');
  assert.equal(sectionOf(track(120, 200))?.label, '副歌');
  assert.equal(sectionOf(track(160, 200))?.label, '桥段');
  assert.equal(sectionOf(track(190, 200))?.label, '尾声');
});

test('长曲只给前后中段，不假装知道主歌副歌', () => {
  assert.equal(sectionOf(track(30, 600))?.label, '开头一段');
  assert.equal(sectionOf(track(200, 600))?.label, '前半段');
  assert.equal(sectionOf(track(360, 600))?.label, '中段');
  assert.equal(sectionOf(track(500, 600))?.label, '后半段');
  assert.equal(sectionOf(track(590, 600))?.label, '收尾段');
});

test('位置或时长缺失时不给段落', () => {
  assert.equal(sectionOf(null), null);
  assert.equal(sectionOf({ ...track(10, 200), positionSeconds: undefined }), null);
  assert.equal(sectionOf({ ...track(10, 200), durationSeconds: undefined }), null);
  assert.equal(sectionOf(track(10, 20)), null);
});

test('无时间轴时可用估算位置与已知时长取段落', () => {
  const noTimeline: Track = { ...track(0, 200), timeline: false, positionSeconds: 0, durationSeconds: undefined };
  assert.equal(sectionOf(noTimeline), null);
  assert.equal(sectionOf(noTimeline, 120, 200)?.label, '副歌');
});
