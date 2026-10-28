/**
 * 本插件自己的单曲笔记，存放在 dataDir/netease-companion/notes.json。
 * 只记录用户明确说过、值得以后再提起的一句话；不与人格记忆或其他插件共享。
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StoragePart } from 'cortico/core/types.ts';
import type { Track } from './state.ts';

export interface SongNote {
  title: string;
  artist: string;
  album: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

interface Data { notes: SongNote[] }
const MAX_NOTES = 100;
const MAX_TEXT = 120;
const trackKey = (track: Pick<Track, 'title' | 'artist' | 'album'>) => JSON.stringify([track.title, track.artist, track.album]);
const clean = (value: unknown, max: number) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

function validNote(value: unknown): value is SongNote {
  if (!value || typeof value !== 'object') return false;
  const note = value as Record<string, unknown>;
  return typeof note.title === 'string' && note.title.trim().length > 0
    && typeof note.text === 'string' && note.text.trim().length > 0
    && typeof note.createdAt === 'string' && typeof note.updatedAt === 'string';
}

export class NotesStore {
  private data: Data | null = null;
  private chain: Promise<void> = Promise.resolve();
  constructor(private dir: string, private now: () => number = Date.now) {}

  get file(): string { return join(this.dir, 'notes.json'); }

  private async load(): Promise<Data> {
    if (this.data) return this.data;
    let notes: SongNote[] = [];
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as { notes?: unknown };
      notes = Array.isArray(raw?.notes) ? raw.notes.filter(validNote).slice(-MAX_NOTES) : [];
    } catch {
      notes = [];
    }
    this.data = { notes };
    return this.data;
  }

  async get(track: Track | null | undefined): Promise<SongNote | null> {
    if (!track) return null;
    const data = await this.load();
    return data.notes.find(note => trackKey(note) === trackKey(track)) ?? null;
  }

  note(track: Track, text: string): Promise<SongNote> {
    const body = clean(text, MAX_TEXT);
    if (!body) return Promise.reject(new Error('笔记内容不能为空'));
    return this.queue(async () => {
      const data = await this.load();
      const at = new Date(this.now()).toISOString();
      const key = trackKey(track);
      const existing = data.notes.find(note => trackKey(note) === key);
      if (existing) {
        existing.text = body;
        existing.updatedAt = at;
      } else {
        data.notes.push({ title: track.title, artist: track.artist, album: track.album, text: body, createdAt: at, updatedAt: at });
      }
      while (data.notes.length > MAX_NOTES) {
        data.notes.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
        data.notes.shift();
      }
      await this.save(data);
      return data.notes.find(note => trackKey(note) === key)!;
    });
  }

  async view(limit = 20): Promise<{ notes: SongNote[]; total: number }> {
    const data = await this.load();
    return {
      notes: [...data.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, Math.max(1, Math.min(100, limit))),
      total: data.notes.length,
    };
  }

  stat(): string {
    if (this.data) return `${this.data.notes.length} 条`;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { notes?: unknown };
      return `${Array.isArray(raw?.notes) ? raw.notes.filter(validNote).length : 0} 条`;
    } catch { return '0 条'; }
  }

  async clear(): Promise<string> {
    await rm(this.file, { force: true });
    this.data = { notes: [] };
    this.chain = Promise.resolve();
    return '已清除单曲笔记';
  }

  storage(): StoragePart {
    return {
      key: 'notes', label: '单曲笔记', kind: 'disk', location: this.file, danger: true,
      note: '只删除本插件记录的歌曲短笔记，不影响听歌记忆、偏好画像、人格或会话。',
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
    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify({ version: 1, updatedAt: new Date(this.now()).toISOString(), notes: data.notes }, null, 2), 'utf8');
    await rename(tmp, this.file);
  }
}
