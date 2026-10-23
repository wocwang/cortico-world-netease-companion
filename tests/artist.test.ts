import test from 'node:test';
import assert from 'node:assert/strict';
import { NeteaseComments, parseArtistAlbums, parseArtistDetail, parseArtistWorks, selectArtistWorks } from '../src/comments.ts';
import { defaults } from '../src/config.ts';
import type { Track } from '../src/state.ts';

const track = (over: Partial<Track> = {}): Track => ({
  title: '晴天', artist: '周杰伦', album: '叶惠美', app: 'cloudmusic', status: 'playing', method: 'smtc', ...over,
});
const windowTrack = (title: string): Track =>
  ({ title, artist: '', album: '', app: 'cloudmusic', status: 'unknown', method: 'window-title' });

const detail = {
  artist: { id: 6452, name: '周杰伦', alias: ['Jay Chou', '周董'], briefDesc: '周杰伦（Jay Chou），华语流行乐男歌手、音乐人。', musicSize: 582, albumSize: 45 },
  hotSongs: [
    { id: 1, name: '晴天', ar: [{ name: '周杰伦' }], al: { name: '叶惠美' } },
    { id: 2, name: '晴天 (Live)', ar: [{ name: '周杰伦' }], al: { name: '演唱会' } },
    { id: 3, name: '晴天', ar: [{ name: '周杰伦' }], al: { name: '叶惠美' } },
    { id: 4, name: '布拉格广场', ar: [{ name: '蔡依林' }, { name: '周杰伦' }], al: { name: '看我72变' } },
    { id: 5, name: '不再联系', ar: [{ name: '某翻唱' }], al: { name: '翻唱集' } },
  ],
};
const albums = { hotAlbums: [
  { id: 1, name: '叶惠美', publishTime: Date.UTC(2003, 6, 31), company: '杰威尔', size: 10 },
  { id: 2, name: '范特西', publishTime: Date.UTC(2001, 8, 14), company: '阿尔发', size: 10 },
] };
const artistSongs = { songs: [
  { id: 1, name: '晴天', artists: [{ name: '周杰伦' }], album: { name: '叶惠美' }, popularity: 100 },
  { id: 2, name: '晴天 (Live)', artists: [{ name: '周杰伦' }], album: { name: '演唱会' }, popularity: 99 },
  { id: 3, name: '布拉格广场', artists: [{ name: '蔡依林' }, { name: '周杰伦' }], album: { name: '看我72变' }, popularity: 98 },
  { id: 4, name: '七里香', artists: [{ name: '周杰伦' }], album: { name: '七里香' }, popularity: 95 },
  { id: 5, name: '晴天', artists: [{ name: '周杰伦' }], album: { name: '叶惠美' }, popularity: 80 },
] };

test('parseArtistDetail 保留简介、别名与作品数量', () => {
  const artist = parseArtistDetail(detail);
  assert.equal(artist?.id, 6452);
  assert.equal(artist?.name, '周杰伦');
  assert.deepEqual(artist?.aliases, ['Jay Chou', '周董']);
  assert.match(artist?.bio ?? '', /华语流行乐男歌手/);
  assert.equal(artist?.musicSize, 582);
  assert.equal(artist?.albumSize, 45);
});

test('parseArtistWorks 过滤现场版、重复与合唱之外的他人作品', () => {
  assert.deepEqual(parseArtistWorks(detail, '周杰伦'), [
    { title: '晴天', album: '叶惠美' },
    { title: '布拉格广场', album: '看我72变' },
  ]);
});

test('selectArtistWorks 只保留主唱作品并按热度排序', () => {
  assert.deepEqual(selectArtistWorks([
    { id: 1, title: '晴天', artists: ['周杰伦'], album: '叶惠美', popularity: 60 },
    { id: 2, title: '七里香', artists: ['周杰伦'], album: '七里香', popularity: 90 },
    { id: 3, title: '晴天 (Live)', artists: ['周杰伦'], album: '演唱会', popularity: 99 },
    { id: 4, title: '布拉格广场', artists: ['蔡依林', '周杰伦'], album: '看我72变', popularity: 100 },
  ], '周杰伦'), [
    { title: '七里香', album: '七里香' },
    { title: '晴天', album: '叶惠美' },
  ]);
});

test('selectArtistWorks 同曲多版本时优先原专辑', () => {
  assert.deepEqual(selectArtistWorks([
    { id: 1, title: '晴天', artists: ['周杰伦'], album: '热门华语282', popularity: 100 },
    { id: 2, title: '晴天', artists: ['周杰伦'], album: '叶惠美', popularity: 60 },
  ], '周杰伦'), [{ title: '晴天', album: '叶惠美' }]);
});

test('parseArtistAlbums 提取年份与公司', () => {
  assert.deepEqual(parseArtistAlbums(albums), [
    { name: '叶惠美', year: 2003, company: '杰威尔' },
    { name: '范特西', year: 2001, company: '阿尔发' },
  ]);
});

test('getArtist 通过歌手目录读取资料并缓存', async () => {
  const calls: string[] = [];
  const fake: typeof fetch = async input => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    const reply = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
    if (url.pathname === '/api/search/get' && url.searchParams.get('type') === '100') {
      return reply({ code: 200, result: { artists: [{ id: 6452, name: '周杰伦', alias: ['Jay Chou'], musicSize: 582, albumSize: 45 }] } });
    }
    if (url.pathname === '/api/v1/artist/6452') return reply({ code: 200, ...detail });
    if (url.pathname === '/api/v1/artist/songs') return reply({ code: 200, ...artistSongs });
    if (url.pathname === '/api/artist/albums/6452') return reply({ code: 200, ...albums });
    return new Response('not found', { status: 404 });
  };
  const client = new NeteaseComments(fake);
  const first = await client.getArtist(track());
  assert.equal(first.status, 'ok');
  assert.equal(first.artist?.name, '周杰伦');
  assert.deepEqual(first.works, [{ title: '晴天', album: '叶惠美' }, { title: '七里香', album: '七里香' }]);
  assert.equal(first.albums?.[0]?.year, 2003);
  assert.equal(first.url, 'https://music.163.com/artist?id=6452');
  const second = await client.getArtist(track());
  assert.equal(second.status, 'ok');
  assert.equal(calls.filter(c => c.startsWith('/api/v1/artist/6452')).length, 1);
  assert.equal(calls.filter(c => c.startsWith('/api/v1/artist/songs')).length, 1);
  assert.equal(calls.filter(c => c.startsWith('/api/search/get')).length, 1);
});

test('getArtist 可从窗口标题解析歌手，缺失歌手时明确不可用', async () => {
  const fake: typeof fetch = async input => {
    const url = new URL(String(input));
    const reply = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
    if (url.pathname === '/api/search/get') return reply({ code: 200, result: { artists: [{ id: 6452, name: '周杰伦', alias: [], musicSize: 582, albumSize: 45 }] } });
    if (url.pathname === '/api/v1/artist/6452') return reply({ code: 200, ...detail });
    if (url.pathname === '/api/v1/artist/songs') return reply({ code: 200, ...artistSongs });
    if (url.pathname === '/api/artist/albums/6452') return reply({ code: 200, ...albums });
    return new Response('not found', { status: 404 });
  };
  const client = new NeteaseComments(fake);
  assert.equal((await client.getArtist(windowTrack('晴天 - 周杰伦'))).status, 'ok');
  const none = await client.getArtist(windowTrack('晴天'));
  assert.equal(none.status, 'unavailable');
  assert.match(none.reason ?? '', /没有可用的歌手信息/);
});

test('歌手资料开关默认开启', () => {
  assert.equal(defaults().artistContext, true);
});
