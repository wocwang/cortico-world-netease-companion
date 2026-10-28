import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotesStore } from '../src/notes.ts';
import type { Track } from '../src/state.ts';

const track = (title: string): Track => ({
  title, artist: '周杰伦', album: '叶惠美', app: 'cloudmusic', status: 'playing', method: 'smtc',
});

test('单曲笔记按曲目保存、更新并持久化', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'netease-notes-'));
  try {
    let now = 1_700_000_000_000;
    const store = new NotesStore(dir, () => now);
    const first = await store.note(track('晴天'), '高中晚自习的回忆');
    assert.equal(first.text, '高中晚自习的回忆');
    now += 1000;
    const updated = await store.note(track('晴天'), '  高考前常听  ');
    assert.equal(updated.text, '高考前常听');
    assert.equal((await store.view()).total, 1);
    const reloaded = new NotesStore(dir);
    assert.equal((await reloaded.get(track('晴天')))?.text, '高考前常听');
    assert.match(store.stat(), /1 条/);
    assert.equal(await store.clear(), '已清除单曲笔记');
    assert.equal(await store.get(track('晴天')), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('空笔记与超长笔记按 120 字处理', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'netease-notes-'));
  try {
    const store = new NotesStore(dir);
    await assert.rejects(store.note(track('晴天'), '   '), /不能为空/);
    const note = await store.note(track('晴天'), '字'.repeat(200));
    assert.equal(note.text.length, 120);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
