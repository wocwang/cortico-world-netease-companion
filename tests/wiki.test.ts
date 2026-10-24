import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchSongWiki, parseSongWiki } from '../src/wiki.ts';

const payload = {
  code: 200,
  data: {
    blocks: [
      {
        code: 'SONG_PLAY_ABOUT_SONG_BASIC',
        creatives: [
          { creativeType: 'songTag', uiElement: { mainTitle: { title: '曲风' } }, resources: [{ uiElement: { mainTitle: { title: '流行-华语流行' } } }] },
          { creativeType: 'songBizTag', uiElement: { mainTitle: { title: '推荐标签' } }, resources: [
            { uiElement: { mainTitle: { title: '思念' } } },
            { uiElement: { mainTitle: { title: '治愈' } } },
            { uiElement: { mainTitle: { title: '思念' } } },
          ] },
          { creativeType: 'language', uiElement: { textLinks: [{ text: '国语' }] } },
          { creativeType: 'bpm', uiElement: { textLinks: [{ text: '69' }] } },
          { creativeType: 'songAward', uiElement: { mainTitle: { title: '获奖成就' }, buttons: [{ text: '2项' }] }, resources: [
            { uiElement: { mainTitle: { title: '第2届hito流行音乐奖' }, subTitles: [{ title: '获' }, { title: 'Hito年度华语歌曲' }] } },
          ] },
          { creativeType: 'entertainment', uiElement: { mainTitle: { title: '影视节目' } }, resources: [
            { uiElement: { mainTitle: { title: '颁奖礼《第四届音乐风云榜》插曲' } } },
          ] },
          { creativeType: 'sheet', uiElement: { mainTitle: { title: '乐谱' }, buttons: [{ text: '10个' }] }, resources: [{ uiElement: {} }] },
          { creativeType: 'songComment', uiElement: { mainTitle: { title: '乐评' } }, resources: [
            { uiElement: { mainTitle: { title: '乐评来自 某人' }, descriptions: [{ description: '这是一段平台乐评。' }] } },
          ] },
        ],
      },
      {
        code: 'SONG_PLAY_ABOUT_SIMILAR_SONG',
        creatives: [{ resources: [
          { resourceType: 'SONG', resourceId: '1827600686', uiElement: { mainTitle: { title: '还是会想你' }, subTitles: [{ title: '林达浪/h3R3' }] } },
        ] }],
      },
      {
        code: 'SONG_PLAY_ABOUT_RELATED_PLAYLIST',
        creatives: [{ resources: [
          { resourceType: 'PLAYLIST', resourceId: '17837620368', uiElement: { mainTitle: { title: '华语好歌' } } },
        ] }],
      },
    ],
  },
};

test('解析网易云音乐百科的结构化字段与乐评', () => {
  const wiki = parseSongWiki(payload, 186016, new Date('2026-10-24T00:00:00Z'));
  assert.ok(wiki);
  assert.deepEqual(wiki.genres, ['流行-华语流行']);
  assert.deepEqual(wiki.tags, ['思念', '治愈']);
  assert.equal(wiki.language, '国语');
  assert.equal(wiki.bpm, 69);
  assert.deepEqual(wiki.awards, ['第2届hito流行音乐奖 获 Hito年度华语歌曲']);
  assert.deepEqual(wiki.appearances, ['颁奖礼《第四届音乐风云榜》插曲']);
  assert.equal(wiki.sheetCount, 10);
  assert.deepEqual(wiki.review, { author: '某人', text: '这是一段平台乐评。' });
  assert.deepEqual(wiki.similar, [{ id: 1827600686, title: '还是会想你', artist: '林达浪/h3R3' }]);
  assert.deepEqual(wiki.playlists, [{ id: 17837620368, title: '华语好歌' }]);
  assert.equal(wiki.url, 'https://music.163.com/song?id=186016');
  assert.equal(wiki.fetchedAt, '2026-10-24T00:00:00.000Z');
});

test('百科没有任何可读内容时返回 null', () => {
  assert.equal(parseSongWiki({ code: 200, data: { blocks: [] } }, 1), null);
});

test('匿名 eapi 请求携带加密参数并解析结果', async () => {
  let seen: { url: string; init?: RequestInit } | undefined;
  const fake: typeof fetch = async (input, init) => {
    seen = { url: String(input), init };
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  const wiki = await fetchSongWiki(186016, undefined, fake);
  assert.ok(seen);
  const url = new URL(seen.url);
  assert.equal(url.hostname, 'interface.music.163.com');
  assert.equal(url.pathname, '/eapi/song/play/about/block/page');
  assert.equal(seen.init?.method, 'POST');
  assert.match(String(seen.init?.body), /^params=/);
  assert.equal(wiki?.bpm, 69);
});

test('百科接口 HTTP 失败会抛出，非 200 code 返回 null', async () => {
  await assert.rejects(fetchSongWiki(1, undefined, async () => new Response('', { status: 500 })), /HTTP 500/);
  assert.equal(await fetchSongWiki(1, undefined, async () => new Response(JSON.stringify({ code: 404 }), { status: 200 })), null);
});
