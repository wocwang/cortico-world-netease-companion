import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { interactionFactor, profileSummary, PreferenceStore } from '../src/preferences.ts';
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
    assert.match(profileSummary(list), /偏好：.*有具体故事/);
    assert.match(profileSummary(list), /避免：.*求赞/);
    const raw = JSON.parse(await readFile(join(dir, 'preferences.json'), 'utf8'));
    assert.equal(raw.version, 2);
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

test('互动频率画像持久化，并按倍率调整主动评论间隔', async () => {
  const dir = await temp();
  try {
    const store = new PreferenceStore(dir);
    assert.equal(store.profileSync(), null);
    await store.setInteraction({ interaction: 'less', reason: '用户说别老说话' });
    assert.equal((await store.profile())?.interaction, 'less');
    assert.equal(store.profileSync()?.reason, '用户说别老说话');
    assert.equal(interactionFactor('more'), 0.75);
    assert.equal(interactionFactor('less'), 1.5);
    assert.equal(interactionFactor('quiet'), 4);
    assert.equal(interactionFactor(null), 1);
    const raw = JSON.parse(await readFile(join(dir, 'preferences.json'), 'utf8'));
    assert.equal(raw.version, 2);
    assert.equal(raw.profile.interaction, 'less');
    assert.match(store.storage().stat(), /少一点/);
    const reloaded = new PreferenceStore(dir);
    assert.equal((await reloaded.profile())?.interaction, 'less');
    assert.equal(reloaded.profileSync()?.reason, '用户说别老说话');
    assert.equal(await store.storage().clear(), '已清除陪听偏好记忆');
    assert.equal(await store.profile(), null);
    assert.equal(store.profileSync(), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('AI 通过工具写入画像并能在当前曲目工具中读到', async () => {
  const dir = await temp();
  try {
    const world = new MusicWorld(defaults(), () => {}, undefined, undefined, dir);
    const call = (name: string, args: Record<string, unknown>) =>
      (world.tools().find(t => t.name === name)!.handler as any)(args, {});
    const out = JSON.parse(String(await call('music_comment_preference', { sentiment: 'like', note: '喜欢讲个人经历的评论', tags: ['story', 'unknown'] })));
    assert.equal(out.stored, true);
    assert.deepEqual(out.entry.tags, ['story']);
    const preset = JSON.parse(String(await call('music_comment_preference', { interaction: 'more', reason: '用户说多聊一点' })));
    assert.equal(preset.stored, true);
    assert.equal(preset.profile.interaction, 'more');
    assert.equal(preset.listeningProfile.interaction, 'more');
    assert.equal(world.envPromptVars()['music.interactionLevel'], '更主动');
    const now = JSON.parse(String(await call('music_now_playing', {})));
    assert.equal(now.commentPreferences.length, 1);
    assert.equal(now.commentPreferences[0].note, '喜欢讲个人经历的评论');
    assert.equal(now.listeningProfile.interaction, 'more');
    assert.match(now.profileSummary, /喜欢讲个人经历的评论/);
    assert.equal(now.commentLimits.intervalSeconds, 90);
    await assert.rejects(call('music_comment_preference', { sentiment: 'love', note: 'x' }), /sentiment/);
    await assert.rejects(call('music_comment_preference', {}), /需要/);
    await assert.rejects(call('music_comment_preference', { interaction: 'loud' }), /interaction/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
