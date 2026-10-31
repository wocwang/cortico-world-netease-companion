import test from 'node:test';
import assert from 'node:assert/strict';
import { styleFromTag, styleOf } from '../src/style.ts';
import type { SongBackground } from '../src/comments.ts';

const background = (genres: string[], tags: string[], bpm?: number): SongBackground => ({
  status: 'ok',
  wiki: { genres, tags, bpm, awards: [], appearances: [], similar: [], playlists: [], url: '', fetchedAt: '' },
});

test('摇滚/高 BPM 给偏燃', () => {
  const style = styleOf(background(['摇滚'], ['现场'], 140));
  assert.equal(style.id, 'energetic');
  assert.equal(style.source, 'inferred');
  assert.equal(style.label, '偏燃');
  // 不再列出具体动作名：当前形象的词表由桌宠自己的环境提示词提供。
  assert.equal('actions' in style, false);
});

test('抒情/低 BPM 给偏柔', () => {
  assert.equal(styleOf(background(['抒情'], [], 70)).id, 'soft');
});

test('老歌、实验和未知风格分别给出不同倾向', () => {
  assert.equal(styleOf(background([], ['老歌'])).id, 'old');
  assert.equal(styleOf(background([], ['实验'])).id, 'odd');
  assert.equal(styleOf(undefined).id, 'neutral');
});

test('已标听感覆盖自动推断', () => {
  const style = styleFromTag('hard', '摇滚');
  assert.equal(style.id, 'energetic');
  assert.equal(style.source, 'tag');
  assert.equal(style.estimated, false);
  assert.equal(style.label, '偏燃（摇滚）');
  assert.equal('actions' in style, false);
});
