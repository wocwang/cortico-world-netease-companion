import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTaste, TasteStore } from '../src/taste.ts';
import type { ListeningHistory } from '../src/listening.ts';

const history: ListeningHistory = {
  status: 'ok', totalPlays: 5,
  days: [{
    date: '2026-10-28', plays: 5,
    tracks: [
      { title: '晴天', artist: '周杰伦', album: '叶惠美', count: 4, lastAt: '2026-10-28T10:00:00.000Z' },
      { title: '起风了', artist: '买辣椒也用券', album: '起风了', count: 1, lastAt: '2026-10-28T11:00:00.000Z' },
    ],
    artists: [
      { name: '周杰伦', count: 4, lastAt: '2026-10-28T10:00:00.000Z' },
      { name: '买辣椒也用券', count: 1, lastAt: '2026-10-28T11:00:00.000Z' },
    ],
    hours: Array(24).fill(0).map((_, hour) => hour === 10 ? 4 : hour === 11 ? 1 : 0),
    players: [{ app: 'cloudmusic', count: 4 }, { app: 'QQMusic', count: 1 }],
  }],
};

test('口味档案汇总常听歌手、曲风、循环曲、时段、播放器与标签', () => {
  const genreMap = new Map([[JSON.stringify(['晴天', '周杰伦', '叶惠美']), ['流行', '华语']]]);
  const taste = buildTaste(history, 30, 0, genreMap);
  assert.equal(taste.totalPlays, 5);
  assert.equal(taste.recordedDays, 1);
  assert.equal(taste.topArtists[0].name, '周杰伦');
  assert.deepEqual(taste.topGenres.map(item => item.name), ['流行', '华语']);
  assert.equal(taste.topGenres[0].count, 4);
  assert.deepEqual(taste.repeatTracks.map(item => item.title), ['晴天']);
  assert.equal(taste.hours.find(item => item.hour === 10)?.count, 4);
  assert.equal(taste.players[0].app, 'cloudmusic');
  assert.equal(taste.players[0].share, 0.8);
  assert.ok(taste.tags.includes('循环型'));
  assert.ok(taste.tags.includes('常用网易云音乐'));
  assert.ok(taste.tags.includes('曲风偏流行'));
  assert.ok(taste.tags.includes('最活跃 10:00'));
  assert.match(taste.summary, /5 次播放/);
});

test('没有逐日记录时用累计排名兜底常听歌手、循环曲与曲风', () => {
  const genreMap = new Map([[JSON.stringify(['晴天', '周杰伦', '叶惠美']), ['流行', '华语']]]);
  const taste = buildTaste({ status: 'empty', totalPlays: 0, days: [] }, 30, 0, genreMap, {
    totalPlays: 7,
    tracks: [
      { title: '晴天', artist: '周杰伦', album: '叶惠美', count: 5 },
      { title: '起风了', artist: '买辣椒也用券', album: '起风了', count: 2 },
    ],
    artists: [{ name: '周杰伦', count: 5 }, { name: '买辣椒也用券', count: 2 }],
  });
  assert.equal(taste.scope, 'cumulative');
  assert.equal(taste.totalPlays, 7);
  assert.equal(taste.recordedDays, 0);
  assert.equal(taste.topArtists[0].name, '周杰伦');
  assert.deepEqual(taste.repeatTracks.map(item => item.title), ['晴天', '起风了']);
  assert.deepEqual(taste.topGenres.map(item => item.name), ['流行', '华语']);
  assert.deepEqual(taste.hours.filter(item => item.count > 0), []);
  assert.deepEqual(taste.players, []);
  assert.ok(taste.tags.includes('循环型'));
  assert.ok(taste.tags.includes('曲风偏流行'));
  assert.match(taste.summary, /累计共 7 次播放/);
});

test('口味档案单独持久化并清除', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'netease-taste-'));
  try {
    const store = new TasteStore(dir, () => 0);
    const profile = await store.refresh(history, 30);
    assert.equal(profile.totalPlays, 5);
    const reloaded = new TasteStore(dir);
    assert.equal((await reloaded.read())?.topArtists[0].name, '周杰伦');
    assert.match(store.stat(), /30 天 · 5 次/);
    assert.equal(await store.clear(), '已清除听歌口味档案');
    assert.equal(await store.read(), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
