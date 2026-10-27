import test from 'node:test';
import assert from 'node:assert/strict';
import { pickBest, searchAndPick, searchNetease, type PickTrack } from '../src/picker.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const netease = (songs: unknown[]) => json({ code: 200, result: { songs } });
const qq = (list: unknown[]) => json({ data: { song: { list } } });

const requestFor = (handler: (url: string) => Response): typeof fetch =>
  (async (input: string | URL | Request) => handler(String(input))) as unknown as typeof fetch;

test('searchAndPick 优先选择歌名歌手完全匹配的网易云结果', async () => {
  const request = requestFor(url => url.includes('music.163.com')
    ? netease([{ id: 1, name: '晴天', artists: [{ name: '周杰伦' }], album: { name: '叶惠美' }, duration: 269000 }])
    : qq([{ songid: 2, songmid: 'abc', songname: '晴天 (Live)', singer: [{ name: '周杰伦' }], albumname: '叶惠美', interval: 269 }]));
  const result = await searchAndPick('晴天 周杰伦', request);
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.equal(result.track.source, 'netease');
  assert.equal(result.track.title, '晴天');
  assert.equal(result.track.url, 'https://music.163.com/song?id=1');
});

test('网易云没有结果时回退到 QQ 音乐', async () => {
  const request = requestFor(url => url.includes('music.163.com')
    ? netease([])
    : qq([{ songid: 2, songmid: 'abc', songname: '晴天', singer: [{ name: '周杰伦' }], albumname: '叶惠美', interval: 269 }]));
  const result = await searchAndPick('晴天', request);
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.equal(result.track.source, 'qq');
  assert.equal(result.track.url, 'https://y.qq.com/n/ryqq/songDetail/abc');
});

test('两边都没有结果时返回 unavailable', async () => {
  const request = requestFor(url => url.includes('music.163.com') ? netease([]) : qq([]));
  assert.deepEqual(await searchAndPick('不存在的歌', request), { status: 'unavailable', reason: '没有搜到合适的曲目' });
});

test('pickBest 过滤过短结果并按歌名歌手排序', () => {
  const tracks: PickTrack[] = [
    { source: 'qq', id: '1', title: '晴天 (Live)', artist: '周杰伦', album: '', durationSeconds: 269, url: 'u1' },
    { source: 'netease', id: '2', title: '晴天', artist: '周杰伦', album: '', durationSeconds: 269, url: 'u2' },
    { source: 'netease', id: '3', title: '晴天', artist: '其他', album: '', durationSeconds: 12, url: 'u3' },
  ];
  assert.equal(pickBest(tracks, '晴天 周杰伦')?.url, 'u2');
  assert.equal(pickBest([], '晴天'), null);
});

test('网易云非 200 code 抛错，便于上层区分限流', async () => {
  const request = requestFor(() => json({ code: 405 }));
  await assert.rejects(searchNetease('晴天', request), /网易云搜索未成功/);
});
