import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLrc, mergeTranslation, currentIndex, briefLyrics, lyricsLabel, isCreditLine } from '../src/lyrics.ts';

test('parseLrc：解析时间标签并按时间排序', () => {
  const raw = [
    '[ti:测试曲]',
    '[ar:某乙]',
    '[00:12.50]第一行',
    '[00:10.00]前面出现但更早',
    '[01:02.345]第三行',
  ].join('\n');
  const lines = parseLrc(raw);
  assert.deepEqual(lines, [
    { at: 10, text: '前面出现但更早' },
    { at: 12.5, text: '第一行' },
    { at: 62.35, text: '第三行' },
  ]);
});

test('parseLrc：一行多个时间标签会展开成多行', () => {
  const lines = parseLrc('[00:05.00][00:20.00]副歌');
  assert.deepEqual(lines, [{ at: 5, text: '副歌' }, { at: 20, text: '副歌' }]);
});

test('parseLrc：丢弃元数据行与制作名单行', () => {
  const raw = [
    '[00:01.00]作词 : 徐若瑄',
    '[00:02.00]编曲 : 周杰伦',
    '[00:03.00]和声编写 : 周杰伦',
    '[00:04.00]鼓 : 陈柏州',
    '[00:05.00]故事的小黄花',
  ].join('\n');
  assert.deepEqual(parseLrc(raw), [{ at: 5, text: '故事的小黄花' }]);
});

test('isCreditLine：只认字段名像制作名单的短前缀', () => {
  assert.equal(isCreditLine('作词 : 某甲'), true);
  assert.equal(isCreditLine('和声编写 : 某乙'), true);
  assert.equal(isCreditLine('Lyrics by : Someone'), true);
  assert.equal(isCreditLine('故事的小黄花'), false);
  // 正文里的冒号不算 credit：前缀太长、带标点或不是制作词
  assert.equal(isCreditLine('我想说 : 这句话很长很长很长很长很长'), false);
  assert.equal(isCreditLine('等，等 : 你'), false);
  assert.equal(isCreditLine('她说 : 走吧'), false);
});

test('parseLrc：空输入、无标签行与空正文都跳过', () => {
  assert.deepEqual(parseLrc(''), []);
  assert.deepEqual(parseLrc('没有标签的一行'), []);
  assert.deepEqual(parseLrc('[00:05.00]   '), []);
});

test('parseLrc：单行截断到 200 字', () => {
  const long = '啊'.repeat(300);
  const lines = parseLrc(`[00:01.00]${long}`);
  assert.equal(lines[0].text.length, 200);
});

test('mergeTranslation：同一时间戳直接合并', () => {
  const lines = parseLrc('[00:12.50]原文\n[00:15.20]第二行');
  const merged = mergeTranslation(lines, '[00:12.50]译文一\n[00:15.20]译文二');
  assert.deepEqual(merged.map(l => l.tr), ['译文一', '译文二']);
});

test('mergeTranslation：0.35 秒内视为同一行，超出不合并', () => {
  const lines = parseLrc('[00:12.50]原文\n[00:30.00]另一行');
  const merged = mergeTranslation(lines, '[00:12.20]近的\n[00:33.00]太远');
  assert.equal(merged[0].tr, '近的');
  assert.equal(merged[1].tr, undefined);
});

test('mergeTranslation：没有翻译时原样返回', () => {
  const lines = parseLrc('[00:12.50]原文');
  assert.equal(mergeTranslation(lines, ''), lines);
  assert.equal(mergeTranslation(lines, '没有时间戳')[0].tr, undefined);
});

test('currentIndex：按进度定位，容忍 0.3 秒提前量', () => {
  const lines = parseLrc('[00:05.00]甲\n[00:10.00]乙\n[00:20.00]丙');
  assert.equal(currentIndex(lines, 0), -1);
  assert.equal(currentIndex(lines, 5.1), 0);
  assert.equal(currentIndex(lines, 4.8), 0);
  assert.equal(currentIndex(lines, 4.5), -1);
  assert.equal(currentIndex(lines, 15), 1);
  assert.equal(currentIndex(lines, 99), 2);
  assert.equal(currentIndex([], 5), -1);
  assert.equal(currentIndex(lines, undefined), -1);
});

test('briefLyrics：只给前 N 行，并附当前行', () => {
  const raw = Array.from({ length: 20 }, (_, i) => `[00:${String(i + 1).padStart(2, '0')}.00]第${i + 1}行`).join('\n');
  const reference = { status: 'ok' as const, total: 20, hasTranslation: false, match: 'metadata' as const, lines: parseLrc(raw) };
  const brief = briefLyrics(reference, 5, 12.5);
  assert.equal(brief.status, 'ok');
  assert.equal(brief.lines?.length, 5);
  assert.equal(brief.total, 20);
  assert.equal(brief.currentLine?.text, '第12行');
});

test('briefLyrics：行数钳制在 1–200，disabled 与非 ok 状态原样透传', () => {
  const lines = parseLrc(Array.from({ length: 260 }, (_, i) => `[0${Math.floor(i / 60) + 1}:${String(i % 60).padStart(2, '0')}.00]行${i}`).join('\n'));
  const reference = { status: 'ok' as const, lines };
  assert.equal(briefLyrics(reference, 0).lines?.length, 1);
  assert.equal(briefLyrics(reference, 999).lines?.length, 200);
  assert.deepEqual(briefLyrics(undefined, 12), { status: 'disabled' });
  assert.deepEqual(briefLyrics({ status: 'disabled' }, 12), { status: 'disabled' });
  assert.deepEqual(briefLyrics({ status: 'empty', reason: '纯音乐' }, 12), { status: 'empty', reason: '纯音乐' });
});

test('lyricsLabel：面板文案区分已关闭、已获取与不可用', () => {
  assert.equal(lyricsLabel(undefined), '已关闭');
  assert.equal(lyricsLabel({ status: 'disabled' }), '已关闭');
  assert.equal(lyricsLabel({ status: 'ok', total: 42, hasTranslation: true }), '已获取 42 行（含翻译）');
  assert.equal(lyricsLabel({ status: 'ok', total: 7 }), '已获取 7 行');
  assert.equal(lyricsLabel({ status: 'unavailable' }), '暂不可用');
});
