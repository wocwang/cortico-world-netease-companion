import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ListeningMemoryStore, LISTENING_DWELL_MS, ReplayCounter } from '../src/listening.ts';
import { MusicWorld } from '../src/world.ts';
import { defaults, listeningLimits } from '../src/config.ts';
import type { Track } from '../src/state.ts';

const temp = () => mkdtemp(join(tmpdir(), 'netease-listening-'));
const media = (over: Partial<Track> = {}): Track => ({
  title: '晴天', artist: '周杰伦', album: '叶惠美', app: 'cloudmusic', status: 'playing', method: 'smtc', ...over,
});

test('听歌记忆聚合曲目与歌手，并给出常听摘要和当前曲目关联', async () => {
  const dir = await temp();
  try {
    const store = new ListeningMemoryStore(dir);
    const at = Date.parse('2026-10-24T10:00:00Z');
    await store.record({ title: '晴天', artist: '周杰伦', album: '叶惠美' }, at);
    await store.record({ title: '晴天', artist: '周杰伦', album: '叶惠美' }, at + 1000);
    await store.record({ title: '起风了', artist: '买辣椒也用券', album: '起风了' }, at + 2000);
    const view = await store.view();
    assert.equal(view.totalPlays, 3);
    assert.equal(view.trackCount, 2);
    assert.equal(view.artistCount, 2);
    assert.equal(view.topArtists[0].name, '周杰伦');
    assert.equal(view.topArtists[0].count, 2);
    assert.equal(view.topTracks[0].title, '晴天');
    assert.match(view.summary, /累计记录 3 次播放/);
    assert.match(view.summary, /周杰伦（2 次）/);
    const relation = await store.relation({ title: '晴天', artist: '周杰伦', album: '叶惠美' });
    assert.equal(relation.track?.count, 2);
    assert.equal(relation.artist?.count, 2);
    assert.equal((await store.relation({ title: '未知', artist: '未知' })).track, undefined);
    const raw = JSON.parse(await readFile(join(dir, 'listening.json'), 'utf8'));
    assert.equal(raw.version, 1);
    assert.equal(raw.totalPlays, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('听歌记忆默认最多保留 100 首与 30 位歌手，同分按随机顺序替换', async () => {
  const dir = await temp();
  try {
    const store = new ListeningMemoryStore(dir, () => ({ tracks: 100, artists: 30 }), () => 0);
    const at = Date.parse('2026-01-01T00:00:00Z');
    for (let i = 0; i < 105; i++) {
      await store.record({ title: `歌-${i}`, artist: `歌手-${i}`, album: '' }, at + i * 1000);
    }
    const view = await store.view(120);
    assert.equal(view.totalPlays, 105);
    assert.equal(view.trackCount, 100);
    assert.equal(view.artistCount, 30);
    assert.ok(view.recentTracks.some(t => t.title === '歌-104'));
    assert.ok(!view.recentTracks.some(t => t.title === '歌-4'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('超过歌曲上限时淘汰播放次数加歌手次数最低的旧歌，同分随机且保护新歌', async () => {
  const dir = await temp();
  try {
    const store = new ListeningMemoryStore(dir, () => ({ tracks: 10, artists: 20 }), () => 0);
    const at = Date.parse('2026-02-01T00:00:00Z');
    for (const [i, title] of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'].entries()) {
      await store.record({ title, artist: `歌手${title}`, album: '' }, at + i * 1000);
    }
    let ranking = await store.ranking();
    assert.equal(ranking.tracks.length, 10);
    assert.ok(!ranking.tracks.some(t => t.title === 'A'));
    assert.ok(ranking.tracks.some(t => t.title === 'K'));
    await store.record({ title: 'B', artist: '歌手B', album: '' }, at + 11_000);
    await store.record({ title: 'L', artist: '歌手L', album: '' }, at + 12_000);
    ranking = await store.ranking();
    assert.equal(ranking.tracks.length, 10);
    assert.equal(ranking.tracks.find(t => t.title === 'B')?.count, 2);
    assert.ok(!ranking.tracks.some(t => t.title === 'C'));
    assert.ok(ranking.tracks.some(t => t.title === 'L'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('听歌排名按次数排序，并分别套用收录上限与显示范围', async () => {
  const dir = await temp();
  try {
    const store = new ListeningMemoryStore(dir, () => ({ tracks: 10, artists: 5, rankTracks: 4, rankArtists: 2 }), () => 0);
    const at = Date.parse('2026-03-01T00:00:00Z');
    await store.record({ title: 'A', artist: '歌手A', album: '' }, at);
    await store.record({ title: 'A', artist: '歌手A', album: '' }, at + 1000);
    for (const [i, title] of ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'].entries()) {
      await store.record({ title, artist: `歌手${title}`, album: '' }, at + 2000 + i * 1000);
    }
    const ranking = await store.ranking();
    assert.deepEqual(ranking.limits, { tracks: 10, artists: 5, rankTracks: 4, rankArtists: 2 });
    assert.equal(ranking.storedTracks, 10);
    assert.equal(ranking.storedArtists, 5);
    assert.equal(ranking.tracks.length, 4);
    assert.equal(ranking.tracks[0].title, 'A');
    assert.equal(ranking.tracks[0].count, 2);
    assert.equal(ranking.tracks[1].title, 'K');
    assert.equal(ranking.tracks[2].title, 'J');
    assert.ok(!ranking.tracks.some(t => t.title === 'B'));
    assert.equal(ranking.artists.length, 2);
    assert.equal(ranking.artists[0].name, '歌手A');
    assert.equal(ranking.artists[0].count, 2);
    assert.equal(ranking.artists[1].name, '歌手K');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('排名显示范围可配置，并受收录上限约束', () => {
  const cfg = defaults();
  assert.deepEqual(listeningLimits(cfg), { tracks: 100, artists: 30, rankTracks: 100, rankArtists: 30 });
  cfg.listeningTrackLimit = 999;
  cfg.listeningArtistLimit = 1;
  cfg.listeningRankTrackRange = 20;
  cfg.listeningRankArtistRange = 999;
  assert.deepEqual(listeningLimits(cfg), { tracks: 500, artists: 5, rankTracks: 20, rankArtists: 5 });
  cfg.listeningRankTrackRange = 0;
  cfg.listeningRankArtistRange = 0;
  assert.deepEqual(listeningLimits(cfg), { tracks: 500, artists: 5, rankTracks: 1, rankArtists: 1 });
});

test('没有播放位置时按曲目时长累计循环，暂停时间不计', () => {
  const counter = new ReplayCounter();
  const t = media();
  let now = 0, plays = 0;
  counter.reset('k', t, now);
  for (now = 2000; now <= 60_000; now += 2000) plays += counter.update('k', t, 60_000, now);
  assert.equal(plays, 1);
  for (let i = 0; i < 15; i++) { now += 2000; plays += counter.update('k', media({ status: 'paused' }), 60_000, now); }
  assert.equal(plays, 1);
  for (let i = 0; i < 30; i++) { now += 2000; plays += counter.update('k', t, 60_000, now); }
  assert.equal(plays, 2);
});

test('有播放位置时按结尾回到开头计一次，普通回拖不计数', () => {
  const counter = new ReplayCounter();
  let plays = 0;
  counter.reset('k', media({ positionSeconds: 0 }), 0);
  plays += counter.update('k', media({ positionSeconds: 2 }), 60_000, 2000);
  plays += counter.update('k', media({ positionSeconds: 58 }), 60_000, 58_000);
  plays += counter.update('k', media({ positionSeconds: 0 }), 60_000, 60_000);
  assert.equal(plays, 1);
  plays += counter.update('k', media({ positionSeconds: 2 }), 60_000, 62_000);
  plays += counter.update('k', media({ positionSeconds: 30 }), 60_000, 90_000);
  plays += counter.update('k', media({ positionSeconds: 10 }), 60_000, 100_000);
  assert.equal(plays, 1);
});

test('听歌记忆支持一次累加多次循环', async () => {
  const dir = await temp();
  try {
    const store = new ListeningMemoryStore(dir);
    const at = Date.parse('2026-10-25T10:00:00Z');
    await store.record({ title: '晴天', artist: '周杰伦', album: '叶惠美' }, at, 3);
    const view = await store.view();
    assert.equal(view.totalPlays, 3);
    assert.equal(view.topTracks[0].count, 3);
    assert.equal(view.topArtists[0].count, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('听歌记忆可持久化并单独清除', async () => {
  const dir = await temp();
  try {
    const store = new ListeningMemoryStore(dir);
    await store.record({ title: '晴天', artist: '周杰伦', album: '叶惠美' }, Date.parse('2026-10-24T10:00:00Z'));
    const reloaded = new ListeningMemoryStore(dir);
    assert.equal((await reloaded.view()).totalPlays, 1);
    assert.match(reloaded.storage().stat(), /1 首/);
    assert.equal(reloaded.storage().location, join(dir, 'listening.json'));
    assert.equal(await reloaded.storage().clear(), '已清除听歌记忆');
    assert.equal((await reloaded.view()).totalPlays, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('同曲分段只在 50% / 80% 触发，并跳过已播位置', () => {
  const world = new MusicWorld({ ...defaults(), segmentComments: true }, () => {});
  const track = media({ durationSeconds: 200 });
  assert.deepEqual((world as any).segmentPoints(track), [100, 160]);
  (world as any).seedSegments({ ...track, positionSeconds: 120 });
  assert.deepEqual([...(world as any).segmentFired], [0]);
  (world as any).seedSegments({ ...track, positionSeconds: 0 });
  assert.deepEqual([...(world as any).segmentFired], []);
  assert.deepEqual((world as any).segmentPoints(media({ durationSeconds: 60 })), []);
});

test('World 在曲目稳定 10 秒后写入听歌记忆，并通过工具暴露关联', async () => {
  const dir = await temp();
  const realNow = Date.now;
  let fake = realNow();
  Date.now = () => fake;
  try {
    const world = new MusicWorld(defaults(), () => {}, undefined, undefined, dir);
    const call = async (name: string, args: Record<string, unknown> = {}) =>
      JSON.parse(String(await (world.tools().find(t => t.name === name)!.handler as any)(args, {})));
    const snapshot = () => ({ track: { title: '晴天', artist: '周杰伦', album: '叶惠美', app: 'cloudmusic', status: 'playing', method: 'smtc' } });
    (world as any).observe(snapshot());
    fake += LISTENING_DWELL_MS - 1000;
    (world as any).observe(snapshot());
    assert.equal((await call('music_listening_memory')).status, 'empty');
    fake += 2000;
    (world as any).observe(snapshot());
    await new Promise(resolve => setTimeout(resolve, 100));
    const memory = await call('music_listening_memory');
    assert.equal(memory.status, 'ok');
    assert.equal(memory.totalPlays, 1);
    assert.equal(memory.relation.track.count, 1);
    assert.equal(memory.relation.artist.name, '周杰伦');
    const now = await call('music_now_playing');
    assert.equal(now.listeningMemory.status, 'ok');
    assert.equal(now.listeningMemory.relation.track.count, 1);
    const snap = await world.webUi().invoke!('live-status', 'snapshot', []) as any;
    assert.match(snap.listening, /1 首/);
  } finally {
    Date.now = realNow;
    await rm(dir, { recursive: true, force: true });
  }
});
