import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TagStore } from '../src/tags.ts';
import type { Track } from '../src/state.ts';

const track = (title: string): Track => ({
  title, artist: '周杰伦', album: '叶惠美', app: 'cloudmusic', status: 'playing', method: 'smtc',
});

test('听感标签按曲目保存、覆盖并持久化', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'netease-tags-'));
  try {
    const store = new TagStore(dir);
    const first = await store.set(track('晴天'), 'hard', '摇滚');
    assert.equal(first.feel, 'hard');
    assert.equal(first.genre, '摇滚');
    const updated = await store.set(track('晴天'), 'soft');
    assert.equal(updated.feel, 'soft');
    assert.equal(updated.genre, undefined);
    const reloaded = new TagStore(dir);
    assert.equal((await reloaded.get(track('晴天')))?.feel, 'soft');
    assert.match(store.stat(), /1 首/);
    assert.equal(await store.clear(), '已清除听感标签');
    assert.equal(await store.get(track('晴天')), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('歌曲百科曲风缓存可与手动听感共存', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'netease-tags-'));
  try {
    const store = new TagStore(dir);
    await store.rememberGenres(track('晴天'), ['流行', '华语']);
    assert.deepEqual((await store.get(track('晴天')))?.genres, ['流行', '华语']);
    await store.set(track('晴天'), 'soft', '抒情');
    const tag = await store.get(track('晴天'));
    assert.equal(tag?.feel, 'soft');
    assert.deepEqual(tag?.genres, ['流行', '华语', '抒情']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('未知听感标签被拒绝', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'netease-tags-'));
  try {
    const store = new TagStore(dir);
    await assert.rejects(store.set(track('晴天'), 'unknown' as never), /未知的听感标签/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
