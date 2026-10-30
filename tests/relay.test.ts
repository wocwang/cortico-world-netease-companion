import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaults } from '../src/config.ts';
import type { Track } from '../src/state.ts';
import { MusicWorld } from '../src/world.ts';
import { matchesWant, WantStore, type WantItem } from '../src/wants.ts';

const temp = () => mkdtemp(join(tmpdir(), 'netease-relay-'));
const want = (over: Partial<WantItem> = {}): WantItem => ({
  id: 'w1', title: '晴天', artist: '周杰伦', album: '叶惠美', link: 'https://music.163.com/song?id=1',
  durationSeconds: 200, source: 'netease', reason: '', at: '2026-10-20T10:00:00.000Z', ...over,
});
const media = (over: Partial<Track> = {}): Track => ({
  title: '晴天', artist: '周杰伦', album: '叶惠美', app: 'cloudmusic', status: 'playing', method: 'smtc', ...over,
});

test('接力匹配：歌名歌手对得上才算，翻唱与别的歌不算', () => {
  assert.equal(matchesWant(want(), media({ durationSeconds: 200 })), true);
  assert.equal(matchesWant(want({ durationSeconds: 0 }), media({ durationSeconds: 199 })), true);
  // 同名翻唱：歌手完全不同，不能当成她递出去的那一首。
  assert.equal(matchesWant(want(), media({ artist: '某某翻唱歌手', durationSeconds: 200 })), false);
  assert.equal(matchesWant(want(), media({ title: '起风了', artist: '买辣椒也用券' })), false);
  // 多歌手按分隔符拆开，任一对上即可。
  assert.equal(matchesWant(want({ artist: '周杰伦 / 费玉清' }), media()), true);
});

test('想听清单记录、播放标记与接力链长度', async () => {
  const dir = await temp();
  try {
    const store = new WantStore(dir);
    const first = await store.remember({ title: '晴天', artist: '周杰伦', album: '叶惠美', link: 'https://a', durationSeconds: 200 });
    const second = await store.remember({ title: '起风了', artist: '买辣椒也用券', album: '起风了', link: 'https://b', durationSeconds: 300 });
    assert.equal((await store.list()).length, 2);
    assert.ok(first.id.length > 0);
    // 重复挑同一首只更新，不新增一棒。
    await store.remember({ title: '晴天', artist: '周杰伦', album: '叶惠美', link: 'https://a2', durationSeconds: 200, reason: '再挑一次' });
    assert.equal((await store.list()).length, 2);
    const matched = await store.match(media({ durationSeconds: 200 }));
    assert.equal(matched?.id, first.id);
    // 没播过的那一棒先不算链；播过才算。
    assert.equal(await store.chainSize(30 * 60_000, Date.now()), 0);
    await store.markPlayed(first.id, Date.now());
    assert.equal(await store.chainSize(30 * 60_000, Date.now()), 1);
    // 隔很久的旧棒不算这一轮。
    assert.equal(await store.chainSize(60_000, Date.now() + 3_600_000), 0);
    await store.resetChain();
    assert.equal(await store.chainSize(30 * 60_000, Date.now()), 0);
    assert.equal((await store.list()).length, 2);
    assert.ok(second.id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('剩约 35 秒时推一次接力，同一首只推一次', async () => {
  const dir = await temp();
  try {
    const world = new MusicWorld(defaults(), () => {}, undefined, undefined, dir);
    const wants: WantStore = (world as any).wants;
    const current = await wants.remember({
      title: '晴天', artist: '周杰伦', album: '叶惠美', link: 'https://music.163.com/song?id=1',
      durationSeconds: 200, reason: '晴天适合今天',
    });
    await wants.remember({
      title: '起风了', artist: '买辣椒也用券', album: '起风了', link: 'https://music.163.com/song?id=2',
      durationSeconds: 300,
    });
    const events: Array<Record<string, any>> = [];
    (world as any).host = {
      pushEvent: async (event: Record<string, any>) => { events.push(event); return { cursor: events.length }; },
    };
    const track = media({ durationSeconds: 200, positionSeconds: 170 });
    (world as any).observe({ track });
    const now = Date.now();
    assert.equal(await (world as any).relayOpportunity(now), true);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'netease-music.relay_pick');
    assert.match(events[0].text, /起风了/);
    assert.match(events[0].text, /2\/6/);
    // 已经提醒过：同一首不会再推第二遍。
    assert.equal(await (world as any).relayOpportunity(now + 1000), false);
    assert.equal(events.length, 1);
    // 位置还早时不推。
    (world as any).observe({ track: media({ durationSeconds: 200, positionSeconds: 60 }) });
    const other = await wants.remember({
      title: '晴天', artist: '周杰伦', album: '叶惠美', link: 'https://music.163.com/song?id=1',
      durationSeconds: 200,
    });
    assert.equal(await (world as any).relayOpportunity(now + 2000), false);
    assert.equal(events.length, 1);
    assert.equal(other.id, current.id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
