/**
 * 本插件自己的陪听记忆，存放在 dataDir/netease-companion/preferences.json。
 * 与人格、会话、其他插件的记忆完全隔离；记录用户明确表达过的评论口味与陪听节奏画像。
 */
import { rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StoragePart } from 'cortico/core/types.ts';
import { dirValue, readDirs, readJsonVariants, writeTextWithFallback, type DirRef } from './storage.ts';

export const PREFERENCE_TAGS = ['story', 'analysis', 'lyrics', 'context', 'humor', 'emotional',
  'background', 'film', 'artist', 'genre', 'generic', 'begging', 'negativity', 'spoiler'] as const;
export type PreferenceTag = typeof PREFERENCE_TAGS[number];
export type PreferenceSentiment = 'like' | 'dislike';
export interface CommentPreference {
  at: string;
  sentiment: PreferenceSentiment;
  note: string;
  tags: PreferenceTag[];
}

export const INTERACTION_LEVELS = ['more', 'normal', 'less', 'quiet'] as const;
export type InteractionLevel = typeof INTERACTION_LEVELS[number];
export const INTERACTION_LABELS: Record<InteractionLevel, string> = {
  more: '更主动', normal: '正常', less: '少一点', quiet: '安静',
};
export interface ListeningProfile {
  at: string;
  interaction: InteractionLevel;
  reason: string;
}

const MAX_ENTRIES = 50;
const MAX_NOTE = 120;
const MAX_REASON = 120;

interface Data {
  entries: CommentPreference[];
  profile: ListeningProfile | null;
}

const validTag = (v: unknown): v is PreferenceTag => typeof v === 'string' && (PREFERENCE_TAGS as readonly string[]).includes(v);
const validLevel = (v: unknown): v is InteractionLevel => typeof v === 'string' && (INTERACTION_LEVELS as readonly string[]).includes(v);

function validPreference(v: unknown): v is CommentPreference {
  const e = v as CommentPreference | null;
  return !!e && (e.sentiment === 'like' || e.sentiment === 'dislike')
    && typeof e.note === 'string' && e.note.length > 0
    && typeof e.at === 'string' && Array.isArray(e.tags);
}

function validProfile(v: unknown): v is ListeningProfile {
  const p = v as ListeningProfile | null;
  return !!p && validLevel(p.interaction) && typeof p.at === 'string' && typeof p.reason === 'string';
}

/** 主动评论间隔倍率：更主动缩短，安静明显拉长。最终仍受配置的 30–3600 秒边界约束。 */
export function interactionFactor(level?: InteractionLevel | null): number {
  switch (level) {
    case 'more': return 0.75;
    case 'less': return 1.5;
    case 'quiet': return 4;
    default: return 1;
  }
}

/** 把最近的口味整理成一句可直接放进提示词的摘要，只使用用户原话，不做推断。 */
export function profileSummary(entries: CommentPreference[]): string {
  const pick = (sentiment: PreferenceSentiment) => entries.filter(e => e.sentiment === sentiment)
    .slice(-2).map(e => e.note.replace(/\s+/g, ' ').trim().slice(0, 24)).filter(Boolean);
  const likes = pick('like'), dislikes = pick('dislike');
  return [likes.length ? `偏好：${likes.join('；')}` : '', dislikes.length ? `避免：${dislikes.join('；')}` : '']
    .filter(Boolean).join(' ｜ ');
}

/** 两处偏好合并：同一条口味只留更晚的，画像取更晚的一份。 */
function mergePreferences(parts: Record<string, unknown>[]): Data {
  const entries = new Map<string, CommentPreference>();
  let profile: ListeningProfile | null = null;
  for (const raw of parts) {
    const list = Array.isArray(raw?.entries) ? raw.entries.filter(validPreference) : [];
    for (const entry of list) {
      const key = `${entry.sentiment}\u0000${entry.note.toLowerCase()}`;
      const found = entries.get(key);
      if (!found || entry.at >= found.at) entries.set(key, entry);
    }
    if (validProfile(raw?.profile) && (!profile || raw.profile.at >= profile.at)) profile = raw.profile;
  }
  return {
    entries: [...entries.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-MAX_ENTRIES),
    profile,
  };
}

export class PreferenceStore {
  private data: Data | null = null;
  private chain: Promise<void> = Promise.resolve();
  private local?: DirRef;
  constructor(private dir: DirRef) {}

  useLocal(dir: DirRef): this { this.local = dir; return this; }

  get file(): string { return join(dirValue(this.dir), 'preferences.json'); }

  private async load(): Promise<Data> {
    if (this.data) return this.data;
    this.data = mergePreferences(await readJsonVariants<Record<string, unknown>>(this.dir, this.local, 'preferences.json'));
    return this.data;
  }

  async list(): Promise<CommentPreference[]> {
    return [...(await this.load()).entries];
  }

  async profile(): Promise<ListeningProfile | null> {
    return (await this.load()).profile;
  }

  /** 供提示词变量等同步场景读取当前画像；不阻塞，也不修改文件。 */
  profileSync(): ListeningProfile | null {
    if (this.data) return this.data.profile;
    const parts: Record<string, unknown>[] = [];
    for (const dir of readDirs(this.dir, this.local)) {
      try {
        parts.push(JSON.parse(readFileSync(join(dir, 'preferences.json'), 'utf8')) as Record<string, unknown>);
      } catch {
        // 这一处没有偏好文件或内容损坏，继续看下一处。
      }
    }
    this.data = mergePreferences(parts);
    return this.data.profile;
  }

  add(input: { sentiment: PreferenceSentiment; note: string; tags?: string[] }): Promise<{ stored: true; count: number; entry: CommentPreference }> {
    const note = input.note.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE);
    if (!note) return Promise.reject(new Error('偏好内容不能为空'));
    const tags = [...new Set((input.tags ?? []).filter(validTag))].slice(0, 3);
    return this.queue(async () => {
      const data = await this.load();
      const index = data.entries.findIndex(e => e.sentiment === input.sentiment && e.note.toLowerCase() === note.toLowerCase());
      if (index >= 0) data.entries.splice(index, 1);
      const entry: CommentPreference = { at: new Date().toISOString(), sentiment: input.sentiment, note, tags };
      data.entries.push(entry);
      while (data.entries.length > MAX_ENTRIES) data.entries.shift();
      await this.save(data);
      return { stored: true as const, count: data.entries.length, entry };
    });
  }

  setInteraction(input: { interaction: InteractionLevel; reason?: string }): Promise<{ stored: true; profile: ListeningProfile }> {
    if (!validLevel(input.interaction)) return Promise.reject(new Error('未知的互动频率'));
    const reason = (input.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_REASON);
    return this.queue(async () => {
      const data = await this.load();
      const profile: ListeningProfile = { at: new Date().toISOString(), interaction: input.interaction, reason };
      data.profile = profile;
      await this.save(data);
      return { stored: true as const, profile };
    });
  }

  private queue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(fn);
    this.chain = result.then(() => undefined, () => undefined);
    return result;
  }

  private async save(data: Data): Promise<void> {
    await writeTextWithFallback(dirValue(this.dir), this.local ? dirValue(this.local) : '', 'preferences.json',
      JSON.stringify({
        version: 2, updatedAt: new Date().toISOString(), entries: data.entries,
        ...(data.profile ? { profile: data.profile } : {}),
      }, null, 2));
  }

  stat(): string {
    const label = (profile: ListeningProfile | null | undefined) => profile ? INTERACTION_LABELS[profile.interaction] : '默认节奏';
    if (this.data) return `${this.data.entries.length} 条 · ${label(this.data.profile)}`;
    const data = mergePreferences(readDirs(this.dir, this.local).map(dir => {
      try { return JSON.parse(readFileSync(join(dir, 'preferences.json'), 'utf8')) as Record<string, unknown>; }
      catch { return {}; }
    }));
    return `${data.entries.length} 条 · ${label(data.profile)}`;
  }

  async clear(): Promise<string> {
    await rm(this.file, { force: true });
    this.data = { entries: [], profile: null };
    this.chain = Promise.resolve();
    return '已清除陪听偏好记忆';
  }

  storage(): StoragePart {
    return {
      key: 'preferences', label: '陪听偏好与画像', kind: 'disk', location: this.file, danger: true,
      note: '只删除本插件记录的评论偏好与陪听节奏画像，不影响人格、会话或其他插件的记忆。',
      stat: () => this.stat(),
      clear: () => this.clear(),
    };
  }
}
