import test from 'node:test';
import assert from 'node:assert/strict';
import { artistKeys, matchSong, NeteaseComments, parseComments, trackLabels, type Song } from '../src/comments.ts';
import { commentLimits, defaults } from '../src/config.ts';
import type { Track } from '../src/state.ts';

const song = (over: Partial<Song> = {}): Song => ({
  id: 1, title: '起风了', artists: ['冯沁苑(买辣椒也用券)'], album: '起风了', ...over,
});
const track = (over: Partial<Track> = {}): Track => ({
  title: '起风了', artist: '买辣椒也用券', album: '起风了', app: 'cloudmusic', status: 'playing', method: 'smtc', ...over,
});
const windowTrack = (title: string): Track =>
  ({ title, artist: '', album: '', app: 'cloudmusic', status: 'unknown', method: 'window-title' });

test('歌手括号别名可以匹配，专辑一致时标为 metadata', () => {
  const found = matchSong(track(), [song()]);
  assert.equal(found?.song.id, 1);
  assert.equal(found?.match, 'metadata');
});

test('专辑不一致不再一票否决，仍返回歌曲但保留版本不确定性', () => {
  const found = matchSong(track({ album: '叶惠美' }), [song({ album: '精选集' })]);
  assert.equal(found?.song.id, 1);
  assert.equal(found?.match, 'title-artist-version-unverified');
});

test('括号版本后缀按基础歌名匹配', () => {
  const found = matchSong(track({ title: '起风了 (Acoustic)', album: '' }), [song()]);
  assert.equal(found?.song.id, 1);
  assert.equal(found?.match, 'title-artist-version-unverified');
});

test('窗口标题支持歌名在前和歌手在前两种顺序', () => {
  assert.equal(matchSong(windowTrack('起风了 - 买辣椒也用券'), [song()])?.song.id, 1);
  assert.equal(matchSong(windowTrack('买辣椒也用券 - 起风了'), [song()])?.song.id, 1);
});

test('窗口标题带网易云后缀时仍可匹配', () => {
  const found = matchSong(windowTrack('起风了 - 买辣椒也用券 - 网易云音乐'), [song()]);
  assert.equal(found?.song.id, 1);
  assert.equal(found?.match, 'title-artist-version-unverified');
});

test('只有歌名的窗口标题按歌名匹配，并标为未核实', () => {
  const found = matchSong(windowTrack('起风了'), [song()]);
  assert.equal(found?.song.id, 1);
  assert.equal(found?.match, 'title-artist-version-unverified');
});

test('不同歌手或不含歌名的标题不会误匹配', () => {
  assert.equal(matchSong(track({ artist: '周深' }), [song()]), null);
  assert.equal(matchSong(windowTrack('晴天 - 周杰伦'), [song()]), null);
});

test('trackLabels 为窗口标题给出双向解析', () => {
  assert.deepEqual(trackLabels(windowTrack('晴天 - 周杰伦')), [
    { title: '晴天', artist: '周杰伦' },
    { title: '周杰伦', artist: '晴天' },
  ]);
  assert.deepEqual(trackLabels(windowTrack('晴天')), [{ title: '晴天', artist: '' }]);
  assert.deepEqual(trackLabels(track()), [{ title: '起风了', artist: '买辣椒也用券' }]);
});

test('artistKeys 包含原名、括号内别名和分隔后的合作歌手', () => {
  const keys = artistKeys('冯沁苑(买辣椒也用券) / 周深');
  assert.ok(keys.includes('冯沁苑'));
  assert.ok(keys.includes('买辣椒也用券'));
  assert.ok(keys.includes('周深'));
});

test('artistKeys 保留完整名称 "AC/DC" 和 "Simon & Garfunkel"', () => {
  const acdc = artistKeys('AC/DC');
  assert.ok(acdc.includes('acdc'));
  assert.ok(!acdc.includes('ac'));
  assert.ok(!acdc.includes('dc'));
  assert.ok(artistKeys('Simon & Garfunkel').includes('simongarfunkel'));
});

test('繁简转换为比较用键，"起风了" == "起風了"', () => {
  const found = matchSong(track({ title: '起風了', artist: '买辣椒也用券' }), [song()]);
  assert.equal(found?.song.id, 1);
});

test('标点归一化，"起风了" == "《起风了》"', () => {
  const found = matchSong(track({ title: '《起风了》', artist: '买辣椒也用券' }), [song()]);
  assert.equal(found?.song.id, 1);
});

test('歌手包含匹配："邓紫棋" can be found in "G.E.M.邓紫棋"', () => {
  const found = matchSong(track({ artist: '邓紫棋', title: '光年之外' }), [{
    id: 100, title: '光年之外', artists: ['G.E.M.邓紫棋'], album: '光年之外'
  }]);
  assert.equal(found?.song.id, 100);
});

test('无分隔符中文窗口标题："起风了-买辣椒也用券"', () => {
  const found = matchSong(windowTrack('起风了-买辣椒也用券'), [song()]);
  assert.equal(found?.song.id, 1);
});

const reply = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });

test('搜索只返回翻唱时，通过歌手目录找到原曲并取评论', async () => {
  const calls: string[] = [];
  const fake: typeof fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    if (url.pathname === '/api/search/get' && url.searchParams.get('type') === '100') {
      return reply({ code: 200, result: { artists: [
        { id: 6452, name: '周杰伦', alias: ['Jay Chou'], musicSize: 582, albumSize: 42 },
      ] } });
    }
    if (url.pathname === '/api/search/get') {
      return reply({ code: 200, result: { songCount: 120, songs: [
        { id: 999, name: '晴天 (深情版)', artists: [{ name: '某翻唱' }], album: { name: '翻唱合集' } },
      ] } });
    }
    if (url.pathname === '/api/v1/artist/songs') {
      return reply({ code: 200, songs: [
        { id: 186016, name: '晴天', ar: [{ name: '周杰伦' }], al: { name: '叶惠美' } },
      ] });
    }
    if (url.pathname === '/api/v1/resource/comments/R_SO_4_186016') {
      return reply({ code: 200,
        hotComments: [{ content: '从前从前有个人爱你很久', likedCount: 120 }],
        comments: [{ content: '雨下整夜', likedCount: 2 }, { content: '还要多久我才能在你身边', likedCount: 1 }] });
    }
    return new Response('not found', { status: 404 });
  };
  const result = await new NeteaseComments(fake).get(
    track({ title: '晴天', artist: '周杰伦', album: '叶惠美' }), undefined, 4);
  assert.equal(result.status, 'ok');
  assert.equal(result.song?.id, 186016);
  assert.equal(result.match, 'metadata');
  assert.deepEqual(result.excerpts?.map(e => e.text), ['从前从前有个人爱你很久', '还要多久我才能在你身边', '雨下整夜']);
  assert.ok(calls.some(c => c.includes('offset=50')));
  assert.ok(calls.some(c => c.includes('type=100')));
  assert.ok(calls.some(c => c.includes('/api/v1/artist/songs')));
});

test('最佳候选评论区为空时，换下一个候选', async () => {
  const fake: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/search/get') {
      return reply({ code: 200, result: { songCount: 2, songs: [
        { id: 11, name: '起风了', artists: [{ name: '冯沁苑(买辣椒也用券)' }], album: { name: '起风了' } },
        { id: 12, name: '起风了 (特别版)', artists: [{ name: '冯沁苑(买辣椒也用券)' }], album: { name: '起风了' } },
      ] } });
    }
    if (url.pathname === '/api/v1/resource/comments/R_SO_4_11') return reply({ code: 200, hotComments: [], comments: [] });
    if (url.pathname === '/api/v1/resource/comments/R_SO_4_12') {
      return reply({ code: 200, hotComments: [{ content: '这一版也很好听', likedCount: 8 }], comments: [] });
    }
    return new Response('not found', { status: 404 });
  };
  const result = await new NeteaseComments(fake).get(track(), undefined, 4);
  assert.equal(result.status, 'ok');
  assert.equal(result.song?.id, 12);
  assert.deepEqual(result.excerpts?.map(e => e.text), ['这一版也很好听']);
});

test('parseComments 优先填满热门，然后用最新补到总数', () => {
  const hotComments = Array.from({ length: 5 }, (_, i) => ({ content: `hot-${i}`, likedCount: i }));
  const comments = Array.from({ length: 20 }, (_, i) => ({ content: `recent-${i}`, likedCount: 0 }));
  const excerpts = parseComments({ hotComments, comments }, 10);
  assert.equal(excerpts.length, 10);
  assert.equal(excerpts.filter(e => e.kind === 'hot').length, 5);
  assert.equal(excerpts.filter(e => e.kind === 'recent').length, 5);
});

test('parseComments 过滤求赞、纯表情与泛泛短评，保留有信息量的评论', () => {
  const excerpts = parseComments({
    hotComments: [
      { content: '👍', likedCount: 9 },
      { content: '666', likedCount: 9 },
      { content: '求赞，送我上去', likedCount: 8 },
      { content: '真好听', likedCount: 5 },
      { content: '那年高考完的夏天，我在出租车上第一次听到这首歌，现在每次前奏响起都会想起那个下午。', likedCount: 3 },
    ],
    comments: [
      { content: '🙏', likedCount: 1 },
      { content: '沙发', likedCount: 1 },
      { content: '前排占座', likedCount: 1 },
      { content: '副歌的弦乐编曲比原版更克制，和歌词里的情绪很搭。', likedCount: 1 },
    ],
  }, 4);
  assert.deepEqual(excerpts.map(e => e.text), [
    '那年高考完的夏天，我在出租车上第一次听到这首歌，现在每次前奏响起都会想起那个下午。',
    '副歌的弦乐编曲比原版更克制，和歌词里的情绪很搭。',
  ]);
});


test('评论条数按配置抓取且热门约占六成', () => {
  const hotComments = Array.from({ length: 20 }, (_, i) => ({ content: `hot-${i}`, likedCount: i }));
  const comments = Array.from({ length: 20 }, (_, i) => ({ content: `recent-${i}`, likedCount: 0 }));
  const excerpts = parseComments({ hotComments, comments }, 10);
  assert.equal(excerpts.length, 10);
  assert.equal(excerpts.filter(e => e.kind === 'hot').length, 6);
  assert.equal(excerpts.filter(e => e.kind === 'recent').length, 4);
  assert.equal(excerpts[0].kind, 'hot');
  assert.equal(excerpts.at(-1)?.kind, 'recent');
});

test('评论上限为 50 条', () => {
  const comments = Array.from({ length: 60 }, (_, i) => ({
    content: `第 ${i} 年夏天我在不同城市听到这首歌，每次都想起当时的朋友和街道。`, likedCount: i,
  }));
  const excerpts = parseComments({ comments }, 80);
  assert.equal(excerpts.length, 50);
});

test('评论条数超过 20 时翻页取更多候选', async () => {
  const calls: string[] = [];
  const page = (offset: number) => Array.from({ length: 100 }, (_, i) => ({
    content: `第 ${offset + i} 年夏天我在不同城市听到这首歌，每次都想起当时的朋友和街道。`, likedCount: offset + i,
  }));
  const fake: typeof fetch = async input => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    const reply = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
    if (url.pathname === '/api/search/get') {
      return reply({ code: 200, result: { songCount: 1, songs: [{ id: 11, name: '晴天', artists: [{ name: '周杰伦' }], album: { name: '叶惠美' } }] } });
    }
    if (url.pathname === '/api/v1/resource/comments/R_SO_4_11') {
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return reply({ code: 200, more: offset === 0, hotComments: [], comments: page(offset) });
    }
    return new Response('not found', { status: 404 });
  };
  const result = await new NeteaseComments(fake).get(track({ title: '晴天', artist: '周杰伦', album: '叶惠美' }), undefined, 30);
  assert.equal(result.excerpts?.length, 30);
  assert.ok(calls.some(c => c.includes('offset=100')));
});

test('开启歌曲背景时附带百度百科词条，并校验歌手', async () => {
  const make = (artistInText: string) => {
    const fake: typeof fetch = async input => {
      const url = new URL(String(input));
      const reply = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
      if (url.pathname === '/api/search/get') {
        return reply({ code: 200, result: { songCount: 1, songs: [{ id: 11, name: '晴天', artists: [{ name: '周杰伦' }], album: { name: '叶惠美' } }] } });
      }
      if (url.pathname === '/api/v1/resource/comments/R_SO_4_11') {
        return reply({ code: 200, hotComments: [{ content: '主歌的吉他分解很干净，副歌进来时层次一下打开。', likedCount: 8 }], comments: [] });
      }
      if (url.hostname === 'baike.baidu.com') {
        return reply({
          title: '晴天', desc: `${artistInText}演唱的流行摇滚歌曲`,
          abstract: `《晴天》是${artistInText}创作并演唱的歌曲，收录于专辑《叶惠美》。`,
          url: 'http://baike.baidu.com/item/晴天',
          card: [{ name: '所属专辑', value: ['《叶惠美》'] }, { name: '谱曲', value: [artistInText] }],
        });
      }
      return new Response('not found', { status: 404 });
    };
    return new NeteaseComments(fake);
  };
  const ok = await make('周杰伦').get(track({ title: '晴天', artist: '周杰伦', album: '叶惠美' }), undefined, 4, true);
  assert.equal(ok.status, 'ok');
  assert.equal(ok.songBackground?.status, 'ok');
  assert.equal(ok.songBackground?.facts?.[0]?.label, '所属专辑');
  assert.match(ok.songBackground?.text ?? '', /周杰伦/);
  const wrong = await make('蔡依林').get(track({ title: '晴天', artist: '周杰伦', album: '叶惠美' }), undefined, 4, true);
  assert.equal(wrong.status, 'ok');
  assert.equal(wrong.songBackground?.status, 'unavailable');
  assert.match(wrong.songBackground?.reason ?? '', /不匹配/);
});

test('最新评论里点赞最高的几条标记为 rising 并优先于普通最新评论', () => {
  const excerpts = parseComments({
    hotComments: [{ content: '主歌的吉他分解很干净，副歌进来时层次一下打开，录音版本比现场更克制。', likedCount: 2 }],
    comments: [
      { content: '高考完那个暑假在网吧第一次听到，后来每次加班到深夜都会放这首。', likedCount: 8 },
      { content: '今天才知道这首歌是 2003 年发行的，专辑封面也很有年代感。', likedCount: 2 },
      { content: '路过', likedCount: 0 },
    ],
  }, 5);
  const kinds = excerpts.map(e => e.kind);
  assert.ok(kinds.includes('rising'));
  assert.ok(kinds.indexOf('rising') < kinds.indexOf('recent'));
  assert.equal(excerpts.find(e => e.kind === 'rising')?.likes, 8);
});

test('置顶评论优先计入热门，重复文本只保留一次', () => {
  const excerpts = parseComments({
    topComments: [{ content: '置顶', likedCount: 9 }],
    hotComments: [{ content: '置顶', likedCount: 9 }, { content: '热评', likedCount: 5 }],
    comments: [{ content: '最新', likedCount: 1 }],
  }, 4);
  assert.deepEqual(excerpts.map(e => e.text), ['置顶', '热评', '最新']);
});

test('评论接口格式异常时抛出可降级错误', () => {
  assert.throws(() => parseComments({}), /评论接口返回格式不可用/);
});

test('评论条数配置限制在 3–50，缺省回退 10', () => {
  const cfg = defaults();
  cfg.commentExcerpts = 100;
  assert.equal(commentLimits(cfg).excerpts, 50);
  cfg.commentExcerpts = 2;
  assert.equal(commentLimits(cfg).excerpts, 3);
  cfg.commentExcerpts = Number.NaN;
  assert.equal(commentLimits(cfg).excerpts, 10);
});
