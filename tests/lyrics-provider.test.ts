import test from 'node:test';
import assert from 'node:assert/strict';
import { NeteaseComments } from '../src/comments.ts';
import type { Track } from '../src/state.ts';

const track: Track = {
  title: '晴天', artist: '周杰伦', album: '叶惠美',
  app: 'cloudmusic', status: 'playing', method: 'smtc',
};

const reply = (data: unknown): Response => new Response(JSON.stringify(data), { status: 200 });
const notFound = (): Response => new Response('not found', { status: 404 });

test('LRCLIB 在网易云没有匹配时兜底同步歌词', async () => {
  const netease: typeof fetch = async input => {
    const url = new URL(String(input));
    return url.hostname === 'music.163.com' && url.pathname === '/api/search/get'
      ? reply({ code: 200, result: { songCount: 0, songs: [] } })
      : notFound();
  };
  let queried = '';
  const lrclib: typeof fetch = async input => {
    const url = new URL(String(input));
    queried = url.toString();
    return reply([{
      trackName: '晴天', artistName: '周杰伦',
      syncedLyrics: '[00:01.00]第一句\n[00:02.00]第二句',
    }]);
  };
  const result = await new NeteaseComments(netease, lrclib).lyrics(track, undefined, 20);
  assert.equal(result.status, 'ok');
  assert.equal(result.source, 'lrclib');
  assert.equal(result.match, 'title-artist-version-unverified');
  assert.deepEqual(result.lines?.map(line => line.text), ['第一句', '第二句']);
  assert.match(queried, /lrclib\.net\/api\/search/);
  assert.match(queried, /track_name=%E6%99%B4%E5%A4%A9/);
});

test('网易云有歌曲但没有歌词时，用 LRCLIB 兜底并保留歌曲信息', async () => {
  const netease: typeof fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname === '/api/search/get') {
      return reply({ code: 200, result: { songCount: 1, songs: [
        { id: 11, name: '晴天', artists: [{ name: '周杰伦' }], album: { name: '叶惠美' } },
      ] } });
    }
    if (url.pathname === '/api/song/lyric') return reply({ code: 200, lrc: { lyric: '' }, tlyric: { lyric: '' } });
    return notFound();
  };
  const lrclib: typeof fetch = async () =>
    reply([{ trackName: '晴天', artistName: '周杰伦', syncedLyrics: '[00:05.00]只剩这一句' }]);
  const result = await new NeteaseComments(netease, lrclib).lyrics(track, undefined, 20);
  assert.equal(result.status, 'ok');
  assert.equal(result.source, 'lrclib');
  assert.equal(result.song?.id, 11);
  assert.equal(result.lines?.[0]?.text, '只剩这一句');
});

test('网易云官方歌词可用时不再请求 LRCLIB', async () => {
  let lrclibCalls = 0;
  const netease: typeof fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname === '/api/search/get') {
      return reply({ code: 200, result: { songCount: 1, songs: [
        { id: 11, name: '晴天', artists: [{ name: '周杰伦' }], album: { name: '叶惠美' } },
      ] } });
    }
    if (url.pathname === '/api/song/lyric') {
      return reply({ code: 200, lrc: { lyric: '[00:01.00]官方第一句' }, tlyric: { lyric: '[00:01.00]官方翻译' } });
    }
    return notFound();
  };
  const lrclib: typeof fetch = async () => {
    lrclibCalls++;
    return reply([]);
  };
  const result = await new NeteaseComments(netease, lrclib).lyrics(track, undefined, 20);
  assert.equal(result.source, 'official-lrc');
  assert.equal(result.hasTranslation, true);
  assert.equal(lrclibCalls, 0);
});
