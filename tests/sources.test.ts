import test from 'node:test';
import assert from 'node:assert/strict';
import { collectBackground, fetchBaiduBaike, fetchDiscogs } from '../src/sources.ts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const fake = (handler: (url: URL) => Response | Promise<Response>): typeof fetch =>
  async input => handler(new URL(String(input)));

test('百度百科概述带来源、https 链接并截断', async () => {
  const request = fake(url => {
    assert.equal(url.hostname, 'baike.baidu.com');
    assert.equal(url.searchParams.get('bk_key'), '周杰伦');
    return json({
      key: '周杰伦', title: '周杰伦',
      desc: '华语流行乐男歌手、原创音乐人',
      abstract: '周杰伦（Jay Chou），1979年1月18日出生于台湾省新北市，华语流行乐男歌手、原创音乐人。'.repeat(20),
      url: 'http://baike.baidu.com/subview/2632/19244814.htm',
    });
  });
  const note = await fetchBaiduBaike('周杰伦', undefined, request);
  assert.equal(note?.source, '百度百科');
  assert.equal(note?.kind, 'encyclopedia');
  assert.equal(note?.title, '周杰伦');
  assert.match(note?.text ?? '', /华语流行乐男歌手/);
  assert.ok((note?.text.length ?? 0) <= 500);
  assert.equal(note?.url, 'https://baike.baidu.com/subview/2632/19244814.htm');
});

test('百度百科完整名无词条时改用中文段重试', async () => {
  const keys: string[] = [];
  const request = fake(url => {
    const key = url.searchParams.get('bk_key') ?? '';
    keys.push(key);
    return key === '邓紫棋'
      ? json({ title: '邓紫棋', abstract: '邓紫棋，华语流行乐女歌手。', url: 'http://baike.baidu.com/item/邓紫棋' })
      : json({ title: '', abstract: '' });
  });
  const note = await fetchBaiduBaike('G.E.M.邓紫棋', undefined, request);
  assert.deepEqual(keys, ['G.E.M.邓紫棋', '邓紫棋']);
  assert.equal(note?.title, '邓紫棋');
  assert.equal(note?.url, 'https://baike.baidu.com/item/邓紫棋');
});

test('百度百科缺概述时返回 null，接口报错时由 collectBackground 降级', async () => {
  assert.equal(await fetchBaiduBaike('周杰伦', undefined, fake(() => json({ title: '周杰伦' }))), null);
  await assert.rejects(fetchBaiduBaike('周杰伦', undefined, fake(() => json({}, 500))), /HTTP 500/);
});

test('Discogs 社区档案保留原名与别名用于同一性校验', async () => {
  const request = fake(url => {
    if (url.pathname === '/database/search') {
      assert.equal(url.searchParams.get('q'), 'Jay Chou');
      assert.equal(url.searchParams.get('type'), 'artist');
      return json({ results: [{ id: 1705275, type: 'artist', title: 'Jay Chou' }] });
    }
    if (url.pathname === '/artists/1705275') {
      return json({
        id: 1705275, name: 'Jay Chou', realname: '周杰倫', namevariations: ['周杰伦', 'Jay'],
        profile: 'Jay Chou is a Taiwanese musician, singer-songwriter and producer.',
        uri: 'https://www.discogs.com/artist/1705275-Jay-Chou',
      });
    }
    return json({}, 404);
  });
  const note = await fetchDiscogs('Jay Chou', undefined, request);
  assert.equal(note?.source, 'Discogs');
  assert.equal(note?.kind, 'community');
  assert.match(note?.text ?? '', /Taiwanese musician/);
  assert.ok(note?.names?.includes('周杰倫'));
  assert.equal(note?.url, 'https://www.discogs.com/artist/1705275-Jay-Chou');
});

test('Discogs 只检索含拉丁字母的歌手名', async () => {
  let called = false;
  const request: typeof fetch = async () => { called = true; return json({}, 500); };
  assert.equal(await fetchDiscogs('周杰伦', undefined, request), null);
  assert.equal(called, false);
});

test('collectBackground 单源失败不拖累另一源', async () => {
  const request = fake(url => {
    if (url.hostname === 'baike.baidu.com') return json({ title: '周杰伦', abstract: '华语流行乐男歌手。' });
    return json({}, 503);
  });
  const notes = await collectBackground('周杰伦', undefined, request);
  assert.equal(notes.length, 1);
  assert.equal(notes[0]?.source, '百度百科');
});
