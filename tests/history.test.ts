import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ListeningMemoryStore } from '../src/listening.ts';
import type { Track } from '../src/state.ts';

const track = (title: string, artist: string, app = 'cloudmusic'): Track => ({
  title, artist, album: '专辑', app, status: 'playing', method: 'smtc',
});

test('逐日历史与累计排名写入同一个 listening.json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'netease-listening-'));
  try {
    const base = new Date(2026, 9, 28, 10, 0, 0).getTime();
    const store = new ListeningMemoryStore(dir);
    await store.record(track('晴天', '周杰伦'), base);
    await store.record(track('起风了', '买辣椒也用券', 'QQMusic'), base + 3_600_000);
    await store.record(track('晴天', '周杰伦'), base + 1_000_000, 3);

    const history = await store.history(1);
    assert.equal(history.status, 'ok');
    assert.equal(history.totalPlays, 5);
    assert.equal(history.days[0].tracks.find(item => item.title === '晴天')?.count, 4);
    assert.equal(history.days[0].players.find(item => item.app === 'QQMusic')?.count, 1);

    const ranking = await store.ranking();
    assert.equal(ranking.totalPlays, 5);
    assert.equal((await store.view()).totalPlays, 5);
    assert.match(store.stat(), /1 天/);
    const raw = JSON.parse(await readFile(join(dir, 'listening.json'), 'utf8'));
    assert.equal(raw.version, 2);
    assert.ok(Array.isArray(raw.days));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('旧 history.json 会合并进 listening.json 并删除', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'netease-listening-'));
  try {
    await writeFile(join(dir, 'history.json'), JSON.stringify({
      days: [{
        date: '2026-10-27', plays: 2,
        tracks: [{ title: '晴天', artist: '周杰伦', album: '叶惠美', count: 2, lastAt: '2026-10-27T10:00:00.000Z' }],
        artists: [{ name: '周杰伦', count: 2, lastAt: '2026-10-27T10:00:00.000Z' }],
        hours: Array(24).fill(0).map((_, hour) => hour === 10 ? 2 : 0),
        players: [{ app: 'cloudmusic', count: 2 }],
      }],
    }), 'utf8');
    const store = new ListeningMemoryStore(dir);
    const history = await store.history(1);
    assert.equal(history.status, 'ok');
    assert.equal(history.totalPlays, 2);
    assert.equal(history.days[0].date, '2026-10-27');
    assert.equal(existsSync(join(dir, 'history.json')), false);
    const raw = JSON.parse(await readFile(join(dir, 'listening.json'), 'utf8'));
    assert.equal(raw.days.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('旧历史不会被时间窗口自动删除', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'netease-listening-'));
  try {
    const base = new Date(2026, 9, 28, 10, 0, 0).getTime();
    const store = new ListeningMemoryStore(dir);
    await store.record(track('晴天', '周杰伦'), base);
    await store.record(track('后来', '刘若英'), base + 400 * 86_400_000);
    assert.equal((await store.history(1)).days.length, 1);
    assert.equal((await store.history(3650)).days.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
