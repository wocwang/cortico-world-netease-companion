/**
 * 本插件自己的听感标签，存放在 dataDir/netease-companion/tags.json。
 * 只描述“该怎么反应”，不声称是客观曲风；用户或桌宠标过一次后，同一首后续沿用。
 */
import { rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StoragePart } from 'cortico/core/types.ts';
import type { Track } from './state.ts';
import { dirValue, readJsonVariants, writeTextWithFallback, type DirRef } from './storage.ts';

export const TAG_FEELS = ['hard', 'soft', 'old', 'odd', 'plain'] as const;
export type TagFeel = typeof TAG_FEELS[number];

export interface SongTag {
  title: string;
  artist: string;
  album: string;
  feel?: TagFeel;
  genre?: string;
  /** 歌曲百科的曲风，或手动曲风；用于个人画像的常听曲风统计。 */
  genres?: string[];
  updatedAt: string;
}

interface Data { tags: SongTag[] }
const MAX_TAGS = 500;
const trackKey = (track: Pick<Track, 'title' | 'artist' | 'album'>) => JSON.stringify([track.title, track.artist, track.album]);
const clean = (value: unknown, max: number) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const validFeel = (value: unknown): value is TagFeel => typeof value === 'string' && (TAG_FEELS as readonly string[]).includes(value);

function validTag(value: unknown): value is SongTag {
  if (!value || typeof value !== 'object') return false;
  const tag = value as Record<string, unknown>;
  const hasGenres = Array.isArray(tag.genres) && tag.genres.some(item => typeof item === 'string' && item.trim());
  return typeof tag.title === 'string' && tag.title.trim().length > 0
    && (validFeel(tag.feel) || hasGenres) && typeof tag.updatedAt === 'string';
}

export class TagStore {
  private data: Data | null = null;
  private chain: Promise<void> = Promise.resolve();
  private local?: DirRef;
  constructor(private dir: DirRef, private now: () => number = Date.now) {}

  useLocal(dir: DirRef): this { this.local = dir; return this; }

  get file(): string { return join(dirValue(this.dir), 'tags.json'); }

  private async load(): Promise<Data> {
    if (this.data) return this.data;
    const merged = new Map<string, SongTag>();
    for (const raw of await readJsonVariants<{ tags?: unknown }>(this.dir, this.local, 'tags.json')) {
      const tags = Array.isArray(raw?.tags) ? raw.tags.filter(validTag) : [];
      for (const tag of tags) {
        const key = trackKey(tag);
        const found = merged.get(key);
        if (!found || tag.updatedAt >= found.updatedAt) merged.set(key, tag);
      }
    }
    this.data = {
      tags: [...merged.values()].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).slice(-MAX_TAGS),
    };
    return this.data;
  }

  async get(track: Track | null | undefined): Promise<SongTag | null> {
    if (!track) return null;
    const data = await this.load();
    return data.tags.find(tag => trackKey(tag) === trackKey(track)) ?? null;
  }

  set(track: Track, feel: TagFeel, genre?: string): Promise<SongTag> {
    if (!validFeel(feel)) return Promise.reject(new Error('未知的听感标签'));
    const cleanGenre = clean(genre, 12);
    return this.queue(async () => {
      const data = await this.load();
      const at = new Date(this.now()).toISOString();
      const key = trackKey(track);
      const existing = data.tags.find(tag => trackKey(tag) === key);
      if (existing) {
        existing.feel = feel;
        if (cleanGenre) {
          existing.genre = cleanGenre;
          existing.genres = [...new Set([...(existing.genres ?? []), cleanGenre])].slice(0, 4);
        } else delete existing.genre;
        existing.updatedAt = at;
      } else {
        data.tags.push({
          title: track.title, artist: track.artist, album: track.album, feel,
          ...(cleanGenre ? { genre: cleanGenre, genres: [cleanGenre] } : {}), updatedAt: at,
        });
      }
      while (data.tags.length > MAX_TAGS) {
        data.tags.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
        data.tags.shift();
      }
      await this.save(data);
      return data.tags.find(tag => trackKey(tag) === key)!;
    });
  }

  /** 歌曲百科返回曲风时顺手缓存，用于个人画像的常听曲风；不覆盖手动听感。 */
  rememberGenres(track: Track, genres: string[]): Promise<void> {
    const list = [...new Set(genres.map(value => clean(value, 20)).filter(Boolean))].slice(0, 4);
    if (!list.length) return Promise.resolve();
    return this.queue(async () => {
      const data = await this.load();
      const key = trackKey(track);
      const existing = data.tags.find(tag => trackKey(tag) === key);
      if (existing) {
        if (JSON.stringify(existing.genres ?? []) === JSON.stringify(list)) return;
        existing.genres = list;
        existing.updatedAt = new Date(this.now()).toISOString();
      } else {
        data.tags.push({ title: track.title, artist: track.artist, album: track.album, genres: list, updatedAt: new Date(this.now()).toISOString() });
      }
      while (data.tags.length > MAX_TAGS) {
        data.tags.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
        data.tags.shift();
      }
      await this.save(data);
    });
  }

  async all(): Promise<SongTag[]> {
    return [...(await this.load()).tags];
  }

  stat(): string {
    if (this.data) return `${this.data.tags.length} 首`;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { tags?: unknown };
      return `${Array.isArray(raw?.tags) ? raw.tags.filter(validTag).length : 0} 首`;
    } catch { return '0 首'; }
  }

  async clear(): Promise<string> {
    await rm(this.file, { force: true });
    this.data = { tags: [] };
    this.chain = Promise.resolve();
    return '已清除听感标签';
  }

  storage(): StoragePart {
    return {
      key: 'tags', label: '听感与曲风标签', kind: 'disk', location: this.file, danger: true,
      note: '只删除本插件记录的听感标签与歌曲百科曲风缓存，不影响听歌记录、听歌口味、单曲笔记、偏好画像、人格或会话。',
      stat: () => this.stat(),
      clear: () => this.clear(),
    };
  }

  private queue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(fn);
    this.chain = result.then(() => undefined, () => undefined);
    return result;
  }

  private async save(data: Data): Promise<void> {
    await writeTextWithFallback(dirValue(this.dir), this.local ? dirValue(this.local) : '', 'tags.json',
      JSON.stringify({ version: 1, updatedAt: new Date(this.now()).toISOString(), tags: data.tags }, null, 2));
  }
}
