import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseFocus, type FocusInput, type FocusKey } from '../src/focus.ts';
import type { SongBackground } from '../src/comments.ts';

const background = (over: Partial<SongBackground> = {}): SongBackground => ({
  status: 'ok', text: '创作背景', facts: [{ label: '专辑', value: '叶惠美' }],
  wiki: { genres: [], tags: [], awards: [], appearances: [], similar: [], playlists: [], url: '', fetchedAt: '' },
  ...over,
});

const input = (over: Partial<FocusInput> = {}): FocusInput => ({
  segmentIndex: -1, background: undefined, artistStatus: 'unavailable', excerptCount: 0,
  memoryStatus: 'unavailable', preferenceCount: 0, profileAvailable: false, ...over,
});

test('开场优先创作背景，用过后换下一个可用角度', () => {
  const used = new Set<FocusKey>();
  const bg = background({ wiki: { genres: [], tags: [], awards: [], appearances: ['某电影'], similar: [], playlists: [], url: '', fetchedAt: '' } });
  const first = chooseFocus(input({ background: bg, artistStatus: 'ok', excerptCount: 3 }), used);
  assert.equal(first.key, 'creation');
  used.add(first.key);
  const second = chooseFocus(input({ background: bg, artistStatus: 'ok', excerptCount: 3 }), used);
  assert.equal(second.key, 'appearance');
  used.add(second.key);
  assert.equal(chooseFocus(input({ background: bg, artistStatus: 'ok', excerptCount: 3 }), used).key, 'artist');
});

test('分段优先歌词和情绪，数据不足时跳到可用角度', () => {
  const lyrics = { status: 'ok' as const, lines: [{ at: 1, text: '一句词' }], total: 1 };
  assert.equal(chooseFocus(input({ segmentIndex: 0, lyrics }), new Set()).key, 'lyrics');
  assert.equal(chooseFocus(input({ segmentIndex: 0 }), new Set()).key, 'mood');
  assert.equal(chooseFocus(input({ segmentIndex: 1 }), new Set()).key, 'scene');
});

test('所有角度用过之后给“换一个说法”', () => {
  const used = new Set<FocusKey>(['mood', 'scene']);
  assert.equal(chooseFocus(input(), used).key, 'variation');
});

test('用户画像和听歌记忆可作为侧重', () => {
  assert.equal(chooseFocus(input({ segmentIndex: 1, memoryStatus: 'ok' }), new Set()).key, 'memory');
  assert.equal(chooseFocus(input({ preferenceCount: 2 }), new Set()).key, 'profile');
});
