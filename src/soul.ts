/**
 * 她自己的口味档案：记忆目录根部的 `music-soul.md`，第一人称。
 *
 * 和 `music_taste` 是两件事：那个是「他听了什么」（数字，算出来的），
 * 这个是「我吃哪一套」（第一人称，她自己写的）。整篇会读进系统提示词，
 * 所以她开口之前的偏好从这里来，而不是临时去查。
 *
 * 刻意不提供"整篇覆写"：这是本插件唯一一个不可恢复的文件，只允许追加与删除。
 */
import { readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { dirValue, readDirs, writeTextWithFallback, type DirRef } from './storage.ts';

export const SOUL_SECTIONS = [
  { id: 'love', title: '我确实爱听' },
  { id: 'ok', title: '听听就算了' },
  { id: 'no', title: '我听不下去的' },
  { id: 'unsure', title: '还没想明白' },
] as const;
export type SoulSectionId = typeof SOUL_SECTIONS[number]['id'];

export interface SoulEntry { section: SoulSectionId; text: string }
export interface SoulSnapshot {
  status: 'ok' | 'empty';
  file: string;
  entries: SoulEntry[];
  text: string;
  updatedAt: string | null;
  note: string;
}

const MAX_TEXT = 60;
const MAX_PER_SECTION = 8;
const MAX_FILE = 6_000;

const clean = (value: unknown): string =>
  typeof value === 'string'
    ? value.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
    : '';

const sectionOf = (value: unknown): SoulSectionId | null => {
  const text = String(value ?? '').trim().toLowerCase();
  const found = SOUL_SECTIONS.find(section => section.id === text || section.title === text);
  return found?.id ?? null;
};

/** 空骨架：四节标题都在，但一条都不写。 */
export function soulSkeleton(): string {
  return ['# 我吃哪一套', '', ...SOUL_SECTIONS.flatMap(section => [`## ${section.title}`, ''])].join('\n');
}

/** 解析 Markdown：只认 `## 标题` 和 `- 条目`，其他行忽略。 */
export function parseSoul(text: string): SoulEntry[] {
  const entries: SoulEntry[] = [];
  let current: SoulSectionId | null = null;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) { current = sectionOf(heading[1]); continue; }
    if (!current) continue;
    const item = line.match(/^[-*]\s+(.+)$/);
    if (!item) continue;
    const value = clean(item[1]);
    if (value) entries.push({ section: current, text: value });
  }
  return entries;
}

/** 把条目写回 Markdown：固定四节顺序，每节最多 MAX_PER_SECTION 条。 */
export function renderSoul(entries: readonly SoulEntry[]): string {
  const lines = ['# 我吃哪一套', ''];
  for (const section of SOUL_SECTIONS) {
    lines.push(`## ${section.title}`);
    for (const entry of entries.filter(item => item.section === section.id).slice(0, MAX_PER_SECTION))
      lines.push(`- ${entry.text}`);
    lines.push('');
  }
  return lines.join('\n').slice(0, MAX_FILE);
}

export class SoulStore {
  private local?: DirRef;
  constructor(private dir: DirRef, local?: DirRef, private now: () => number = Date.now) {
    this.local = local;
  }

  useLocal(dir: DirRef): this { this.local = dir; return this; }

  get file(): string { return join(dirValue(this.dir), 'music-soul.md'); }

  /** 读：当前目录优先，其次本机旧目录，都没有就是空骨架。 */
  private readText(): { text: string; found: boolean; updatedAt: string | null } {
    for (const dir of readDirs(this.dir, this.local)) {
      try {
        const file = join(dir, 'music-soul.md');
        const text = readFileSync(file, 'utf8');
        if (text.trim()) return { text, found: true, updatedAt: this.updatedAt(dir) };
      } catch {
        // 这一处没有档案。
      }
    }
    return { text: soulSkeleton(), found: false, updatedAt: null };
  }

  private updatedAt(dir: string): string | null {
    try {
      return new Date(statSync(join(dir, 'music-soul.md')).mtimeMs).toISOString();
    } catch {
      return null;
    }
  }

  async snapshot(): Promise<SoulSnapshot> {
    const first = this.readText();
    let text = first.text;
    let updatedAt = first.updatedAt;
    // 第一次读时把空骨架落到记忆目录：文件在，用户才找得到、也才知道清理不会碰它。
    if (!first.found) {
      await this.write([]);
      const again = this.readText();
      text = again.text;
      updatedAt = again.updatedAt;
    }
    const entries = parseSoul(text);
    return {
      status: entries.length ? 'ok' : 'empty',
      file: this.file, entries, text, updatedAt,
      note: entries.length
        ? `共 ${entries.length} 条，整篇会读进系统提示词。`
        : '还没有写过任何一条；这份文件只在她自己形成判断时追加。',
    };
  }

  /** 供系统提示词直接使用；没写过时返回一句明确的空态，而不是空白。 */
  promptText(): string {
    const { text, found } = this.readText();
    if (!found || !parseSoul(text).length) return '（还没写过：没有明确偏好时不要编造，也不要照着用户的话抄。）';
    return text.trim();
  }

  async add(section: unknown, value: unknown): Promise<SoulSnapshot> {
    const id = sectionOf(section);
    if (!id) throw new Error('section 必须是 love / ok / no / unsure 或对应的中文标题');
    const text = clean(value);
    if (!text) throw new Error('text 不能为空，且不超过 60 字');
    const { text: current } = this.readText();
    const entries = parseSoul(current);
    if (entries.some(entry => entry.section === id && entry.text === text)) return this.snapshot();
    entries.push({ section: id, text });
    await this.write(entries);
    return this.snapshot();
  }

  /** 按条目原文删除；index 是该节内的 1 起始序号。 */
  async drop(target: { text?: unknown; index?: unknown; section?: unknown }): Promise<SoulSnapshot> {
    const { text: current } = this.readText();
    const entries = parseSoul(current);
    const section = target.section === undefined ? null : sectionOf(target.section);
    if (target.section !== undefined && !section) throw new Error('section 必须是 love / ok / no / unsure 或对应的中文标题');
    const text = clean(target.text);
    if (text) {
      const index = entries.findIndex(entry => entry.text === text && (!section || entry.section === section));
      if (index < 0) throw new Error('档案里没有这条');
      entries.splice(index, 1);
    } else {
      const index = Number(target.index);
      const list = section ? entries.filter(entry => entry.section === section) : entries;
      if (!Number.isFinite(index) || index < 1 || index > list.length) throw new Error('index 超出范围');
      const victim = list[Math.floor(index) - 1];
      const real = entries.indexOf(victim);
      if (real < 0) throw new Error('档案里没有这条');
      entries.splice(real, 1);
    }
    await this.write(entries);
    return this.snapshot();
  }

  /** 清空条目但保留文件骨架；不可恢复的只有条目本身，骨架留着方便继续写。 */
  async clear(): Promise<string> {
    try { rmSync(this.file, { force: true }); } catch { /* 没有文件也算清空 */ }
    await this.write([]);
    return '已清空口味档案条目，文件骨架保留';
  }

  private async write(entries: SoulEntry[]): Promise<void> {
    await writeTextWithFallback(dirValue(this.dir), this.local ? dirValue(this.local) : '',
      'music-soul.md', renderSoul(entries.slice(0, SOUL_SECTIONS.length * MAX_PER_SECTION)));
  }
}
