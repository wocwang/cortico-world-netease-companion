import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importMemory, previewImport } from '../src/import.ts';

const temp = () => mkdtemp(join(tmpdir(), 'netease-import-'));
const day = (date: string, plays: number, title: string) => ({
  date, plays, hours: Array(24).fill(0).map((_, hour) => (hour === 10 ? plays : 0)),
  tracks: [{ title, artist: '周杰伦', album: '叶惠美', count: plays, lastAt: `${date}T10:00:00.000Z` }],
  artists: [{ name: '周杰伦', count: plays, lastAt: `${date}T10:00:00.000Z` }],
  players: [{ app: 'cloudmusic', count: plays }],
});
const listening = (days: ReturnType<typeof day>[]) => JSON.stringify({
  version: 2, totalPlays: days.reduce((sum, item) => sum + item.plays, 0),
  tracks: [], artists: [], days,
});
const notes = (text: string, updatedAt: string) => JSON.stringify({
  version: 1, updatedAt,
  notes: [{ title: '晴天', artist: '周杰伦', album: '叶惠美', text, createdAt: updatedAt, updatedAt }],
});

async function seed(dir: string, files: Record<string, string>): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const [name, text] of Object.entries(files))
    await writeFile(join(dir, name), text, 'utf8');
}

test('导入预览列出文件、条数与重叠天数，并提示合并会重复计数', async () => {
  const dir = await temp();
  try {
    const memory = join(dir, 'memory');
    const source = join(dir, 'source');
    await seed(memory, {
      'listening.json': listening([day('2026-10-20', 1, '晴天')]),
      'notes.json': notes('旧笔记', '2026-10-01T00:00:00.000Z'),
    });
    await seed(source, {
      'listening.json': listening([day('2026-10-20', 2, '晴天'), day('2026-10-21', 1, '起风了')]),
      'notes.json': notes('新笔记', '2026-10-20T00:00:00.000Z'),
      'music-soul.md': '## 我确实爱听\n- 喜欢钢琴\n',
    });
    const preview = previewImport(source, memory);
    assert.equal(preview.status, 'ok');
    assert.equal(preview.overlapDays, 1);
    assert.deepEqual(preview.files.map(file => file.name), ['listening.json', 'notes.json', 'music-soul.md']);
    assert.equal(preview.files[0].source, 2);
    assert.equal(preview.files[0].current, 1);
    assert.equal(preview.files[0].merged, 2);
    assert.match(preview.note, /同一天/);

    assert.equal(previewImport(join(dir, 'missing'), memory).status, 'invalid');
    assert.equal(previewImport(memory, memory).status, 'invalid');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('合并导入：听歌记录按日期相加，笔记取更新的，口味快照不导入并留备份', async () => {
  const dir = await temp();
  try {
    const memory = join(dir, 'memory');
    const source = join(dir, 'source');
    await seed(memory, {
      'listening.json': listening([day('2026-10-20', 1, '晴天')]),
      'notes.json': notes('旧笔记', '2026-10-01T00:00:00.000Z'),
      'music-soul.md': '## 我确实爱听\n- 喜欢钢琴\n',
      'taste.json': JSON.stringify({ version: 1, updatedAt: '2026-10-01T00:00:00.000Z', windowDays: 7, totalPlays: 1 }),
    });
    await seed(source, {
      'listening.json': listening([day('2026-10-20', 2, '晴天'), day('2026-10-21', 1, '起风了')]),
      'notes.json': notes('新笔记', '2026-10-20T00:00:00.000Z'),
      'music-soul.md': '## 我听不下去的\n- 受不了电音轰炸\n',
      'taste.json': JSON.stringify({ version: 1, updatedAt: '2026-10-20T00:00:00.000Z', windowDays: 7, totalPlays: 3 }),
    });
    const result = await importMemory(source, memory, 'merge');
    assert.equal(result.status, 'ok');
    assert.ok(result.imported.includes('listening.json'));
    assert.ok(result.imported.includes('notes.json'));
    assert.ok(result.imported.includes('music-soul.md'));
    assert.ok(result.skipped.includes('taste.json'));
    assert.ok(result.backup);

    const merged = JSON.parse(await readFile(join(memory, 'listening.json'), 'utf8'));
    assert.equal(merged.days.length, 2);
    assert.equal(merged.days[0].plays, 3);
    assert.equal(merged.totalPlays, 4);
    const note = JSON.parse(await readFile(join(memory, 'notes.json'), 'utf8'));
    assert.equal(note.notes[0].text, '新笔记');
    const soul = await readFile(join(memory, 'music-soul.md'), 'utf8');
    assert.match(soul, /喜欢钢琴/);
    assert.match(soul, /受不了电音轰炸/);
    const backed = JSON.parse(await readFile(join(result.backup!, 'listening.json'), 'utf8'));
    assert.equal(backed.totalPlays, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('替换导入：用来源覆盖同名文件，并备份覆盖前的版本', async () => {
  const dir = await temp();
  try {
    const memory = join(dir, 'memory');
    const source = join(dir, 'source');
    await seed(memory, { 'listening.json': listening([day('2026-10-20', 1, '晴天')]) });
    await seed(source, { 'listening.json': listening([day('2026-10-21', 9, '起风了')]) });
    const result = await importMemory(source, memory, 'replace');
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.imported, ['listening.json']);
    assert.ok(result.backup);
    const replaced = JSON.parse(await readFile(join(memory, 'listening.json'), 'utf8'));
    assert.equal(replaced.totalPlays, 9);
    assert.equal(replaced.days[0].date, '2026-10-21');
    const old = JSON.parse(await readFile(join(result.backup!, 'listening.json'), 'utf8'));
    assert.equal(old.totalPlays, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
