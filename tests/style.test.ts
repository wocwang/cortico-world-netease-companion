import test from 'node:test';
import assert from 'node:assert/strict';
import { styleFromTag, styleOf } from '../src/style.ts';
import type { SongBackground } from '../src/comments.ts';

const background = (genres: string[], tags: string[], bpm?: number): SongBackground => ({
  status: 'ok',
  wiki: { genres, tags, bpm, awards: [], appearances: [], similar: [], playlists: [], url: '', fetchedAt: '' },
});

const motions = ['点头', '小跳', '跳舞', '坐下', '转圈', '张望', '摇头'];

test('摇滚/高 BPM 给偏燃动作', () => {
  const style = styleOf(background(['摇滚'], ['现场'], 140), motions);
  assert.equal(style.id, 'energetic');
  assert.equal(style.source, 'inferred');
  assert.deepEqual(style.actions, ['跳舞', '小跳', '点头']);
});

test('抒情/低 BPM 给偏柔动作', () => {
  const style = styleOf(background(['抒情'], [], 70), motions);
  assert.equal(style.id, 'soft');
  assert.deepEqual(style.actions, ['点头', '坐下']);
});

test('老歌、实验和未知风格分别给出不同动作', () => {
  assert.equal(styleOf(background([], ['老歌']), motions).id, 'old');
  assert.deepEqual(styleOf(background([], ['老歌']), motions).actions, ['点头', '转圈']);
  assert.equal(styleOf(background([], ['实验']), motions).id, 'odd');
  assert.deepEqual(styleOf(background([], ['实验']), motions).actions, ['张望', '摇头']);
  assert.equal(styleOf(undefined, motions).id, 'neutral');
  assert.deepEqual(styleOf(undefined, motions).actions, ['点头', '坐下']);
});

test('已标听感覆盖自动推断', () => {
  const style = styleFromTag('hard', '摇滚', ['小跳', '点头']);
  assert.equal(style.id, 'energetic');
  assert.equal(style.source, 'tag');
  assert.equal(style.estimated, false);
  assert.equal(style.label, '偏燃（摇滚）');
  assert.deepEqual(style.actions, ['小跳', '点头']);
});

test('动作按当前形象词表过滤，没有可用动作时返回空', () => {
  assert.deepEqual(styleOf(background(['摇滚'], [], 140), ['小跳']).actions, ['小跳']);
  assert.deepEqual(styleOf(background(['抒情'], [], 70), ['跳舞']).actions, []);
});
