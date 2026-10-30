/**
 * 导入记忆：把一个文件夹里的本插件数据并进当前记忆目录。
 *
 * 两种模式：
 * - 合并（默认）：听歌记录按日期逐项相加，笔记/标签取更新的，偏好去重，口味档案与想听清单取并集；
 *   口味快照是派生数据，不导入，会按合并后的记录重新生成。
 * - 替换：用来源文件覆盖当前同名文件，用于恢复备份。
 *
 * 两种模式都先把当前文件备份到「记忆目录/import-backup/<时间戳>/」，只保留最近三份。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { copyFile, mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { asListeningData, mergeListeningData, serializeListening } from './listening.ts';
import { mergeNotes, serializeNotes } from './notes.ts';
import { mergeTags, serializeTags } from './tags.ts';
import { mergePreferences, serializePreferences } from './preferences.ts';
import { mergeWants, serializeWants } from './wants.ts';
import { parseSoul, renderSoul, type SoulEntry } from './soul.ts';
import { sameDir, writeTextWithFallback } from './storage.ts';

export type ImportMode = 'merge' | 'replace';

interface ImportFile {
  name: string;
  kind: 'listening' | 'notes' | 'tags' | 'preferences' | 'wants' | 'soul' | 'taste';
  label: string;
  /** 合并模式下参与合并的文件；false 表示只在替换模式下处理。 */
  mergeable: boolean;
}

const FILES: ImportFile[] = [
  { name: 'listening.json', kind: 'listening', label: '听歌记录', mergeable: true },
  { name: 'notes.json', kind: 'notes', label: '单曲笔记', mergeable: true },
  { name: 'tags.json', kind: 'tags', label: '听感标签', mergeable: true },
  { name: 'preferences.json', kind: 'preferences', label: '陪听偏好', mergeable: true },
  { name: 'wants.json', kind: 'wants', label: '想听清单', mergeable: true },
  { name: 'music-soul.md', kind: 'soul', label: '口味档案', mergeable: true },
  { name: 'taste.json', kind: 'taste', label: '口味快照', mergeable: false },
];

export interface ImportFilePreview {
  name: string;
  label: string;
  source: number;
  current: number;
  /** 合并模式下的预计条数；替换模式等于 source。 */
  merged: number;
  mergeable: boolean;
}

export interface ImportPreview {
  status: 'ok' | 'empty' | 'invalid';
  source: string;
  memory: string;
  files: ImportFilePreview[];
  /** 听歌记录里同一天在两边都有的天数：合并会相加，可能是重复计数。 */
  overlapDays: number;
  note: string;
}

const readJson = (dir: string, name: string): Record<string, unknown> | null => {
  try {
    const raw = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  } catch {
    return null;
  }
};
const readText = (dir: string, name: string): string => {
  try { return readFileSync(join(dir, name), 'utf8'); } catch { return ''; }
};

/** 每类文件用哪个字段计数；窗口与界面都只看条数，不解析全文。 */
const COUNT_FIELD: Partial<Record<ImportFile['kind'], string>> = {
  listening: 'days', notes: 'notes', tags: 'tags', preferences: 'entries', wants: 'items',
};

function itemCount(dir: string, file: ImportFile): number {
  if (file.kind === 'soul') return parseSoul(readText(dir, file.name)).length;
  if (file.kind === 'taste') return existsSync(join(dir, file.name)) ? 1 : 0;
  const field = COUNT_FIELD[file.kind];
  const list = field ? readJson(dir, file.name)?.[field] : null;
  return Array.isArray(list) ? list.length : 0;
}

/** 口味档案并集：同一节同一条只留一次，保持先出现的顺序。 */
function unionSoul(entries: SoulEntry[]): SoulEntry[] {
  const seen = new Set<string>();
  const out: SoulEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.section}\u0000${entry.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

function mergedCount(sourceDir: string, memoryDir: string, file: ImportFile): number {
  const current = readJson(memoryDir, file.name) ?? {};
  const incoming = readJson(sourceDir, file.name) ?? {};
  switch (file.kind) {
    case 'listening':
      return mergeListeningData([asListeningData(current), asListeningData(incoming)]).days.length;
    case 'notes': return mergeNotes([current, incoming]).length;
    case 'tags': return mergeTags([current, incoming]).length;
    case 'preferences': return mergePreferences([current, incoming]).entries.length;
    case 'wants': return mergeWants([current, incoming]).length;
    case 'soul':
      return unionSoul([...parseSoul(readText(memoryDir, file.name)), ...parseSoul(readText(sourceDir, file.name))]).length;
    default:
      return itemCount(sourceDir, file);
  }
}

/** 导入预览：来源有哪些文件、当前有多少、合并后大概多少。 */
export function previewImport(sourceDir: string, memoryDir: string): ImportPreview {
  const source = String(sourceDir ?? '').trim();
  const base = { source, memory: memoryDir, files: [] as ImportFilePreview[], overlapDays: 0 };
  if (!source || !existsSync(source))
    return { ...base, status: 'invalid', note: '这个文件夹不存在，或路径填错了。' };
  if (sameDir(source, memoryDir))
    return { ...base, status: 'invalid', note: '来源就是当前记忆目录，不需要导入。' };
  const files: ImportFilePreview[] = [];
  for (const file of FILES) {
    if (!existsSync(join(source, file.name))) continue;
    files.push({
      name: file.name, label: file.label, mergeable: file.mergeable,
      source: itemCount(source, file), current: itemCount(memoryDir, file),
      merged: file.mergeable ? mergedCount(source, memoryDir, file) : itemCount(source, file),
    });
  }
  if (!files.length)
    return { ...base, status: 'empty', note: '这个文件夹里没有找到本插件的记忆文件（listening.json / notes.json / music-soul.md 等）。' };
  const current = asListeningData(readJson(memoryDir, 'listening.json'));
  const incoming = asListeningData(readJson(source, 'listening.json'));
  const overlapDays = incoming.days.filter(day => current.days.some(item => item.date === day.date)).length;
  const note = overlapDays
    ? `两边有 ${overlapDays} 天同一天都有听歌记录：合并会把它们相加，如果你导入的是本机旧备份，可能重复计数；这种情况请选「替换」。`
    : '读取正常。合并会保留两边的记录；替换会用来源覆盖当前同名文件（导入前自动备份当前文件）。';
  return { ...base, files, overlapDays, status: 'ok', note };
}

/** 备份当前记忆文件；只保留最近三份导入备份。 */
async function backupCurrent(memoryDir: string, names: string[]): Promise<string | null> {
  if (!names.length) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const root = join(memoryDir, 'import-backup');
  const backup = join(root, stamp);
  await mkdir(backup, { recursive: true });
  for (const name of names) await copyFile(join(memoryDir, name), join(backup, name)).catch(() => {});
  try {
    const dirs = readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    while (dirs.length > 3) await rm(join(root, dirs.shift()!), { recursive: true, force: true });
  } catch {
    // 清理旧备份失败不影响这次导入。
  }
  return backup;
}

/** 合并单个文件，返回写盘文本；无法合并时返回 null。 */
function mergeText(sourceDir: string, memoryDir: string, name: string): string | null {
  switch (name) {
    case 'listening.json':
      return serializeListening(mergeListeningData([
        asListeningData(readJson(memoryDir, name)),
        asListeningData(readJson(sourceDir, name)),
      ]));
    case 'notes.json':
      return serializeNotes(mergeNotes([readJson(memoryDir, name) ?? {}, readJson(sourceDir, name) ?? {}]));
    case 'tags.json':
      return serializeTags(mergeTags([readJson(memoryDir, name) ?? {}, readJson(sourceDir, name) ?? {}]));
    case 'preferences.json':
      return serializePreferences(mergePreferences([readJson(memoryDir, name) ?? {}, readJson(sourceDir, name) ?? {}]));
    case 'wants.json':
      return serializeWants(mergeWants([readJson(memoryDir, name) ?? {}, readJson(sourceDir, name) ?? {}]));
    case 'music-soul.md':
      return renderSoul(unionSoul([...parseSoul(readText(memoryDir, name)), ...parseSoul(readText(sourceDir, name))]));
    default:
      return null;
  }
}

/** 执行导入。合并模式逐文件合并，替换模式覆盖；都会先备份当前文件。 */
export async function importMemory(sourceDir: string, memoryDir: string, mode: ImportMode): Promise<{
  status: 'ok' | 'invalid';
  backup: string | null;
  imported: string[];
  skipped: string[];
  note: string;
}> {
  const preview = previewImport(sourceDir, memoryDir);
  if (preview.status !== 'ok')
    return { status: 'invalid', backup: null, imported: [], skipped: [], note: preview.note };
  const targets = preview.files.filter(file => mode === 'replace' || file.mergeable);
  const backup = await backupCurrent(memoryDir, targets.map(file => file.name));
  const imported: string[] = [];
  const skipped: string[] = [];
  for (const file of preview.files) {
    if (mode === 'merge' && !file.mergeable) {
      skipped.push(file.name);
      continue;
    }
    if (mode === 'replace') {
      const target = join(memoryDir, file.name);
      const tmp = `${target}.tmp`;
      await copyFile(join(sourceDir, file.name), tmp);
      await rename(tmp, target);
      imported.push(file.name);
      continue;
    }
    const text = mergeText(sourceDir, memoryDir, file.name);
    if (text === null) { skipped.push(file.name); continue; }
    await writeTextWithFallback(memoryDir, '', file.name, text);
    imported.push(file.name);
  }
  const note = mode === 'merge'
    ? `已合并 ${imported.length} 个文件${skipped.length ? `，跳过 ${skipped.length} 个（口味快照会按合并后的记录重新生成）` : ''}。`
    : `已用来源覆盖 ${imported.length} 个文件。`;
  return { status: 'ok', backup, imported, skipped, note };
}
