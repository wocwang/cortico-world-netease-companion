/**
 * 本插件自己的陪听偏好记忆，存放在 dataDir/netease-companion/preferences.json。
 * 与人格、会话、其他插件的记忆完全隔离；只记录用户明确表达过的评论口味。
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StoragePart } from 'cortico/core/types.ts';

export const PREFERENCE_TAGS = ['story', 'analysis', 'lyrics', 'context', 'humor', 'emotional', 'generic', 'begging', 'negativity', 'spoiler'] as const;
export type PreferenceTag = typeof PREFERENCE_TAGS[number];
export type PreferenceSentiment = 'like' | 'dislike';
export interface CommentPreference {
  at: string;
  sentiment: PreferenceSentiment;
  note: string;
  tags: PreferenceTag[];
}

const MAX_ENTRIES = 50;
const MAX_NOTE = 120;

const validTag = (v: unknown): v is PreferenceTag => typeof v === 'string' && (PREFERENCE_TAGS as readonly string[]).includes(v);

function validPreference(v: unknown): v is CommentPreference {
  const e = v as CommentPreference | null;
  return !!e && (e.sentiment === 'like' || e.sentiment === 'dislike')
    && typeof e.note === 'string' && e.note.length > 0
    && typeof e.at === 'string' && Array.isArray(e.tags);
}

export class PreferenceStore {
  private entries: CommentPreference[] | null = null;
  private chain: Promise<void> = Promise.resolve();
  constructor(private dir: string) {}

  get file(): string { return join(this.dir, 'preferences.json'); }

  private async load(): Promise<CommentPreference[]> {
    if (this.entries) return this.entries;
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8'));
      this.entries = Array.isArray(raw?.entries) ? raw.entries.filter(validPreference).slice(-MAX_ENTRIES) : [];
    } catch {
      this.entries = [];
    }
    return this.entries ?? [];
  }

  async list(): Promise<CommentPreference[]> {
    return [...await this.load()];
  }

  add(input: { sentiment: PreferenceSentiment; note: string; tags?: string[] }): Promise<{ stored: true; count: number; entry: CommentPreference }> {
    const note = input.note.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE);
    if (!note) return Promise.reject(new Error('偏好内容不能为空'));
    const tags = [...new Set((input.tags ?? []).filter(validTag))].slice(0, 3);
    const result = this.chain.then(() => this.write(input.sentiment, note, tags));
    this.chain = result.then(() => undefined, () => undefined);
    return result;
  }

  private async write(sentiment: PreferenceSentiment, note: string, tags: PreferenceTag[]): Promise<{ stored: true; count: number; entry: CommentPreference }> {
    const list = await this.load();
    const index = list.findIndex(e => e.sentiment === sentiment && e.note.toLowerCase() === note.toLowerCase());
    if (index >= 0) list.splice(index, 1);
    const entry: CommentPreference = { at: new Date().toISOString(), sentiment, note, tags };
    list.push(entry);
    while (list.length > MAX_ENTRIES) list.shift();
    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify({ version: 1, updatedAt: entry.at, entries: list }, null, 2), 'utf8');
    await rename(tmp, this.file);
    this.entries = list;
    return { stored: true, count: list.length, entry };
  }

  stat(): string {
    if (this.entries) return `${this.entries.length} 条`;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8'));
      return `${Array.isArray(raw?.entries) ? raw.entries.length : 0} 条`;
    } catch { return '0 条'; }
  }

  async clear(): Promise<string> {
    await rm(this.file, { force: true });
    this.entries = [];
    this.chain = Promise.resolve();
    return '已清除陪听偏好记忆';
  }

  storage(): StoragePart {
    return {
      key: 'preferences', label: '陪听偏好记忆', kind: 'disk', location: this.file, danger: true,
      note: '只删除本插件记录的评论偏好，不影响人格、会话或其他插件的记忆。',
      stat: () => this.stat(),
      clear: () => this.clear(),
    };
  }
}
