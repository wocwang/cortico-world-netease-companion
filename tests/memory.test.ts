import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ListeningMemoryStore } from '../src/listening.ts';
import { NotesStore } from '../src/notes.ts';
import { SoulStore, parseSoul, soulSkeleton } from '../src/soul.ts';
import { clearWriteFallback, isMigrated, lastWriteFallback, migrateMemory, migrationPlan, readDirs, resolveLayout, sameDir, writeTextWithFallback } from '../src/storage.ts';
import { defaults } from '../src/config.ts';
import { MusicWorld } from '../src/world.ts';
import type { Track } from '../src/state.ts';

const temp = () => mkdtemp(join(tmpdir(), 'netease-memory-'));
const track = (title: string): Track => ({
  title, artist: '周杰伦', album: '叶惠美', app: 'cloudmusic', status: 'playing', method: 'smtc',
});

test('记忆位置：留空跟本机，自定义目录可用时切过去，不可用时退回并说明原因', async () => {
  const dir = await temp();
  try {
    const local = join(dir, 'local');
    const custom = join(dir, 'custom');
    const blank = resolveLayout(local, '');
    assert.equal(blank.memory, local);
    assert.equal(blank.custom, false);
    assert.equal(blank.problem, null);
    assert.equal(resolveLayout(local, local).custom, false);
    assert.equal(sameDir(custom.toUpperCase(), custom), true);
    assert.deepEqual(readDirs(custom, local), [custom, local]);

    const usable = resolveLayout(local, custom);
    assert.equal(usable.custom, true);
    assert.equal(usable.memory, custom);
    assert.match(String(usable.notice), /还是空的/);

    const blocked = join(dir, 'blocked');
    await writeFile(blocked, 'x', 'utf8');
    const broken = resolveLayout(local, blocked);
    assert.equal(broken.custom, false);
    assert.equal(broken.memory, local);
    assert.match(String(broken.problem), /用不了/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('读取合并本机旧记录与自定义目录：同一天逐项相加，不丢切换前的历史', async () => {
  const dir = await temp();
  try {
    const local = join(dir, 'local');
    const memory = join(dir, 'memory');
    const at = Date.parse('2026-10-20T10:00:00Z');
    const before = new ListeningMemoryStore(local);
    await before.record({ title: '晴天', artist: '周杰伦', album: '叶惠美' }, at, 2);
    const after = new ListeningMemoryStore(memory);
    await after.record({ title: '起风了', artist: '买辣椒也用券', album: '起风了' }, at + 3_600_000, 1);
    const merged = new ListeningMemoryStore(memory).useLocal(local);
    const history = await merged.history(3);
    assert.equal(history.status, 'ok');
    assert.equal(history.totalPlays, 3);
    assert.equal(history.days.length, 1);
    assert.equal(history.days[0].plays, 3);
    assert.equal(history.days[0].tracks.find(item => item.title === '晴天')?.count, 2);
    // 写入只落当前目录：本机旧文件保持冻结，不会被新记录改写。
    const localRaw = JSON.parse(await readFile(join(local, 'listening.json'), 'utf8'));
    assert.equal(localRaw.totalPlays, 2);
    const memoryRaw = JSON.parse(await readFile(join(memory, 'listening.json'), 'utf8'));
    assert.equal(memoryRaw.totalPlays, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('单曲笔记同一首在两处都有时保留更新时间更晚的那条', async () => {
  const dir = await temp();
  try {
    const local = join(dir, 'local');
    const memory = join(dir, 'memory');
    await mkdir(local, { recursive: true });
    await mkdir(memory, { recursive: true });
    const item = (text: string, updatedAt: string) => ({
      version: 1, updatedAt, notes: [{
        title: '晴天', artist: '周杰伦', album: '叶惠美', text, createdAt: updatedAt, updatedAt,
      }],
    });
    await writeFile(join(local, 'notes.json'), JSON.stringify(item('旧笔记', '2026-10-01T00:00:00.000Z')), 'utf8');
    await writeFile(join(memory, 'notes.json'), JSON.stringify(item('新笔记', '2026-10-20T00:00:00.000Z')), 'utf8');
    const store = new NotesStore(memory).useLocal(local);
    const note = await store.get(track('晴天'));
    assert.equal(note?.text, '新笔记');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('自定义目录写不进去时回落到本机并留下记录', async () => {
  const dir = await temp();
  try {
    clearWriteFallback();
    const local = join(dir, 'local');
    const blocked = join(dir, 'blocked');
    await writeFile(blocked, 'not a folder', 'utf8');
    const used = await writeTextWithFallback(blocked, local, 'probe.json', '{"ok":true}');
    assert.equal(used, local);
    assert.ok(lastWriteFallback());
    const raw = JSON.parse(await readFile(join(local, 'probe.json'), 'utf8'));
    assert.equal(raw.ok, true);
  } finally {
    clearWriteFallback();
    await rm(dir, { recursive: true, force: true });
  }
});

test('口味档案：只追加与删除，整篇可用于提示词，清理不碰它', async () => {
  const dir = await temp();
  try {
    const store = new SoulStore(dir);
    const empty = await store.snapshot();
    assert.equal(empty.status, 'empty');
    assert.deepEqual(empty.entries, []);
    assert.match(store.promptText(), /还没写过/);
    assert.match(await readFile(store.file, 'utf8'), /## 我确实爱听/);

    await store.add('love', '偏爱钢琴与慢节奏');
    await store.add('no', '受不了电音轰炸');
    const filled = await store.snapshot();
    assert.equal(filled.status, 'ok');
    assert.equal(filled.entries.length, 2);
    assert.equal(filled.entries[0].section, 'love');
    assert.match(store.promptText(), /偏爱钢琴与慢节奏/);

    // 重复写同一条不会变成两条。
    const again = await store.add('love', '偏爱钢琴与慢节奏');
    assert.equal(again.entries.length, 2);

    await store.drop({ text: '受不了电音轰炸' });
    assert.equal((await store.snapshot()).entries.length, 1);
    await store.drop({ section: 'love', index: 1 });
    assert.equal((await store.snapshot()).entries.length, 0);
    await assert.rejects(store.drop({ index: 99 }), /超出范围/);

    await store.clear();
    assert.ok((await readFile(store.file, 'utf8')).includes('## 还没想明白'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('切换目录后一次性迁移：复制缺失文件、写标记并停止合并读取', async () => {
  const dir = await temp();
  try {
    const local = join(dir, 'local');
    const memory = join(dir, 'memory');
    await mkdir(local, { recursive: true });
    await writeFile(join(local, 'listening.json'), JSON.stringify({
      version: 2, totalPlays: 2, tracks: [], artists: [], days: [],
    }), 'utf8');
    const plan = migrationPlan(memory, local, true);
    assert.equal(plan.status, 'ready');
    assert.equal(plan.needed, true);
    assert.equal(plan.canMark, true);
    const result = await migrateMemory(memory, local);
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.copied, ['listening.json']);
    assert.equal(result.marked, true);
    assert.equal(isMigrated(memory, local), true);
    assert.equal(migrationPlan(memory, local, true).status, 'done');

    // 迁移后这台机器只读新目录：同一段历史不会被合并成两倍（否则是 4）。
    const world = new MusicWorld({ ...defaults(), memoryDir: memory }, () => {}, undefined, undefined, local);
    await (world as any).ensureMigration();
    const cumulative = await (world as any).listening.cumulative();
    assert.equal(cumulative.totalPlays, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('两边都有不同内容时不覆盖，也不写迁移标记，继续合并读取', async () => {
  const dir = await temp();
  try {
    const local = join(dir, 'local');
    const memory = join(dir, 'memory');
    await mkdir(local, { recursive: true });
    await mkdir(memory, { recursive: true });
    await writeFile(join(local, 'listening.json'), JSON.stringify({ version: 2, totalPlays: 1, tracks: [], artists: [], days: [] }), 'utf8');
    await writeFile(join(memory, 'listening.json'), JSON.stringify({ version: 2, totalPlays: 12345, tracks: [], artists: [], days: [] }), 'utf8');
    const plan = migrationPlan(memory, local, true);
    assert.equal(plan.canMark, false);
    assert.equal(plan.files.find(file => file.name === 'listening.json')?.action, 'conflict');
    const result = await migrateMemory(memory, local);
    assert.equal(result.marked, false);
    assert.deepEqual(result.copied, []);
    assert.deepEqual(result.conflicts, ['listening.json']);
    assert.equal(isMigrated(memory, local), false);
    const kept = JSON.parse(await readFile(join(memory, 'listening.json'), 'utf8'));
    assert.equal(kept.totalPlays, 12345);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('口味档案 Markdown 解析只认四节标题与短横条目', () => {
  const text = `- 游离行（没有节标题，忽略）\n${soulSkeleton()}\n## 我确实爱听\n- 喜欢现场\n* 喜欢旧歌\n`;
  assert.deepEqual(parseSoul(text), [
    { section: 'love', text: '喜欢现场' },
    { section: 'love', text: '喜欢旧歌' },
  ]);
});
