import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PreferenceStore } from '../src/preferences.ts';
import { MusicWorld } from '../src/world.ts';
import { defaults } from '../src/config.ts';

const temp = () => mkdtemp(join(tmpdir(), 'netease-pref-'));

test('偏好记忆写入独立文件，按 sentiment+note 去重', async () => {
  const dir = await temp();
  try {
    const store = new PreferenceStore(dir);
    await store.add({ sentiment: 'like', note: '喜欢有具体故事的评论', tags: ['story'] });
    await store.add({ sentiment: 'dislike', note: '别读求赞和打卡的', tags: ['begging'] });
    const first = await store.add({ sentiment: 'like', note: '喜欢有具体故事的评论', tags: ['story', 'emotional'] });
    assert.equal(first.count, 2);
    const list = await store.list();
    assert.equal(list.length, 2);
    assert.equal(list.at(-1)?.note, '喜欢有具体故事的评论');
    assert.deepEqual(list.at(-1)?.tags, ['story', 'emotional']);
    const raw = JSON.parse(await readFile(join(dir, 'preferences.json'), 'utf8'));
    assert.equal(raw.version, 1);
    assert.equal(raw.entries.length, 2);
    assert.equal(store.storage().location, join(dir, 'preferences.json'));
    assert.match(store.storage().stat(), /2 条/);
    assert.equal(await store.storage().clear(), '已清除陪听偏好记忆');
    assert.match(store.storage().stat(), /0 条/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('偏好记忆最多保留 50 条，空内容与未知标签被忽略', async () => {
  const dir = await temp();
  try {
    const store = new PreferenceStore(dir);
    await assert.rejects(store.add({ sentiment: 'like', note: '   ' }), /偏好内容不能为空/);
    for (let i = 0; i < 55; i++) await store.add({ sentiment: 'like', note: `偏好-${i}`, tags: ['unknown-tag'] });
    const list = await store.list();
    assert.equal(list.length, 50);
    assert.equal(list[0].note, '偏好-5');
    assert.equal(list.at(-1)?.note, '偏好-54');
    assert.deepEqual(list.at(-1)?.tags, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('AI 通过工具写入偏好并能在当前曲目工具中读到', async () => {
  const dir = await temp();
  try {
    const world = new MusicWorld(defaults(), () => {}, undefined, undefined, dir);
    const call = (name: string, args: Record<string, unknown>) =>
      (world.tools().find(t => t.name === name)!.handler as any)(args, {});
    const out = JSON.parse(String(await call('music_comment_preference', { sentiment: 'like', note: '喜欢讲个人经历的评论', tags: ['story', 'unknown'] })));
    assert.equal(out.stored, true);
    assert.deepEqual(out.entry.tags, ['story']);
    const now = JSON.parse(String(await call('music_now_playing', {})));
    assert.equal(now.commentPreferences.length, 1);
    assert.equal(now.commentPreferences[0].note, '喜欢讲个人经历的评论');
    await assert.rejects(call('music_comment_preference', { sentiment: 'love', note: 'x' }), /sentiment/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
