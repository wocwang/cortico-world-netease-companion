/**
 * 想听清单：她搜到、挑中的歌记在这里，用于接力点歌。
 *
 * 和 `picker.ts` 的区别：那里只查曲库，这里记「她递出去过哪几首、哪首真的被播到了」。
 * 记录本身也是记忆（跟着人走），因此和听歌记录放在同一个记忆目录。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Track } from './state.ts';
import { dirValue, readJsonVariants, writeTextWithFallback, type DirRef } from './storage.ts';

export interface WantItem {
  id: string;
  title: string;
  artist: string;
  album: string;
  link: string;
  durationSeconds: number;
  source: string;
  /** 她挑这首的理由；只用于接力时提醒她别重复同一句。 */
  reason: string;
  at: string;
  /** 已经提醒过接力；落盘后重启也不会再说一遍。 */
  relayedAt?: string;
  /** 这首歌真的被播到了，用来算接力链长度。 */
  playedAt?: string;
}
interface Data { version: 1; updatedAt: string; items: WantItem[] }

const MAX_WANTS = 30;
const MAX_REASON = 120;

const norm = (value: unknown): string =>
  typeof value === 'string' ? value.normalize('NFKC').replace(/\s+/g, '').toLowerCase() : '';
const clean = (value: unknown, max = 120): string =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const artistTokens = (value: unknown): string[] =>
  typeof value === 'string'
    ? value.split(/[\u3001/&,，|]+/).map(norm).filter(Boolean)
    : [];

function validWant(value: unknown): value is WantItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && item.id.length > 0
    && typeof item.title === 'string' && item.title.length > 0
    && typeof item.artist === 'string' && typeof item.album === 'string'
    && typeof item.link === 'string' && typeof item.source === 'string'
    && typeof item.reason === 'string' && typeof item.at === 'string';
}

/**
 * 当前播放的是不是她递出去的那首。歌名必须对上，歌手按分隔符拆开任一对上即可，
 * 时长只能加分不能单独成立——否则翻唱会被当成同一首。
 */
export function matchesWant(want: WantItem, track: Pick<Track, 'title' | 'artist' | 'album' | 'durationSeconds'>): boolean {
  const wanted = norm(want.title);
  const played = norm(track.title);
  const titleHit = played && wanted
    ? (played === wanted ? 60 : (played.includes(wanted) || wanted.includes(played) ? 45 : 0))
    : 0;
  const mine = artistTokens(want.artist);
  const theirs = artistTokens(track.artist);
  const artistHit = mine.some(name => theirs.includes(name)) ? 30 : 0;
  const durationHit = want.durationSeconds > 0 && (track.durationSeconds ?? 0) > 0
    && Math.abs(want.durationSeconds - (track.durationSeconds ?? 0)) <= 5 ? 10 : 0;
  const albumHit = !!norm(want.album) && norm(want.album) === norm(track.album) ? 5 : 0;
  // 歌名对上但歌手完全对不上（同名翻唱）不能算她递出去的那一首。
  if (!titleHit || !artistHit) return false;
  return titleHit + artistHit + durationHit + albumHit >= 55;
}

/** 写盘格式集中在这里，导入时也复用。 */
export function serializeWants(items: WantItem[], updatedAt = new Date().toISOString()): string {
  return JSON.stringify({ version: 1, updatedAt, items }, null, 2);
}

/** 两处想听清单合并：同一 id 保留更晚的一条，按时间排序后截上限。 */
export function mergeWants(parts: Array<{ items?: unknown }>): WantItem[] {
  const items = new Map<string, WantItem>();
  for (const raw of parts) {
    const list = Array.isArray(raw?.items) ? raw.items.filter(validWant) : [];
    for (const item of list) {
      const found = items.get(item.id);
      if (!found || item.at >= found.at) items.set(item.id, item);
    }
  }
  return [...items.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-MAX_WANTS);
}

export class WantStore {
  private data: Data | null = null;
  private chain: Promise<void> = Promise.resolve();
  private local?: DirRef;
  constructor(private dir: DirRef, private now: () => number = Date.now) {}

  useLocal(dir: DirRef): this { this.local = dir; return this; }

  resetCache(): void { this.data = null; }

  get file(): string { return join(dirValue(this.dir), 'wants.json'); }

  private async load(): Promise<Data> {
    if (this.data) return this.data;
    const items = mergeWants(await readJsonVariants<{ items?: unknown }>(this.dir, this.local, 'wants.json'));
    this.data = { version: 1, updatedAt: new Date(this.now()).toISOString(), items };
    return this.data;
  }

  async list(): Promise<WantItem[]> {
    return [...(await this.load()).items].reverse();
  }

  /** 记一棒。同一首再挑一次就刷新理由与时间，并把接力标记清掉（那是新一轮）。 */
  remember(input: {
    title: string; artist: string; album?: string; link: string; source?: string;
    durationSeconds?: number; reason?: string;
  }): Promise<WantItem> {
    if (!clean(input.title)) return Promise.reject(new Error('title 不能为空'));
    if (!clean(input.link)) return Promise.reject(new Error('link 不能为空'));
    return this.queue(async () => {
      const data = await this.load();
      const at = new Date(this.now()).toISOString();
      const key = `${norm(input.title)}\u0000${norm(input.artist)}`;
      const existing = data.items.find(item => `${norm(item.title)}\u0000${norm(item.artist)}` === key);
      if (existing) {
        existing.link = clean(input.link, 300);
        existing.reason = clean(input.reason, MAX_REASON);
        existing.at = at;
        delete existing.relayedAt;
        delete existing.playedAt;
        await this.save({ ...data, updatedAt: at, items: data.items.filter(item => item !== existing).concat(existing) });
        return { ...existing };
      }
      const item: WantItem = {
        id: `w${this.now().toString(36)}${data.items.length}`,
        title: clean(input.title), artist: clean(input.artist), album: clean(input.album),
        link: clean(input.link, 300), source: clean(input.source, 20) || 'netease',
        durationSeconds: Math.max(0, Math.round(Number(input.durationSeconds) || 0)),
        reason: clean(input.reason, MAX_REASON), at,
      };
      const items = [...data.items, item].slice(-MAX_WANTS);
      await this.save({ ...data, updatedAt: at, items });
      return { ...item };
    });
  }

  /** 当前播放的是清单里的哪一首（未播放过的优先，其次是最近挑的）。 */
  async match(track: Pick<Track, 'title' | 'artist' | 'album' | 'durationSeconds'> | null): Promise<WantItem | null> {
    if (!track) return null;
    const data = await this.load();
    const hits = data.items.filter(item => matchesWant(item, track));
    if (!hits.length) return null;
    return hits.sort((a, b) => Number(!!a.playedAt) - Number(!!b.playedAt) || b.at.localeCompare(a.at))[0];
  }

  /** 标记这一棒真的被播到了；同一首只记一次。 */
  async markPlayed(id: string, at = this.now()): Promise<void> {
    await this.update(id, item => { if (!item.playedAt) item.playedAt = new Date(at).toISOString(); });
  }

  /** 标记已经提醒过接力；重启后不会再对同一首说一遍。 */
  async markRelayed(id: string, at = this.now()): Promise<void> {
    await this.update(id, item => { item.relayedAt = new Date(at).toISOString(); });
  }

  /** 这一轮已经完整播过的棒数：用来判断链是不是满了。 */
  async chainSize(withinMs: number, at = this.now()): Promise<number> {
    const data = await this.load();
    const cutoff = new Date(at - withinMs).toISOString();
    return data.items.filter(item => item.playedAt && item.playedAt >= cutoff).length;
  }

  /** 链满了或隔太久：把播放标记清掉，让下次点歌算新的一轮。 */
  async resetChain(): Promise<void> {
    await this.queue(async () => {
      const data = await this.load();
      const items = data.items.map(item => {
        const copy = { ...item };
        delete copy.playedAt;
        delete copy.relayedAt;
        return copy;
      });
      await this.save({ ...data, updatedAt: new Date(this.now()).toISOString(), items });
    });
  }

  private async update(id: string, mutate: (item: WantItem) => void): Promise<void> {
    await this.queue(async () => {
      const data = await this.load();
      const item = data.items.find(entry => entry.id === id);
      if (!item) return;
      mutate(item);
      await this.save({ ...data, updatedAt: new Date(this.now()).toISOString(), items: data.items });
    });
  }

  private queue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(fn);
    this.chain = result.then(() => undefined, () => undefined);
    return result;
  }

  private async save(data: Data): Promise<void> {
    await writeTextWithFallback(dirValue(this.dir), this.local ? dirValue(this.local) : '', 'wants.json',
      serializeWants(data.items, data.updatedAt));
    this.data = data;
  }

  async clear(): Promise<string> {
    this.data = { version: 1, updatedAt: new Date(this.now()).toISOString(), items: [] };
    await this.save(this.data);
    return '已清空想听清单';
  }

  stat(): string {
    if (this.data) return `${this.data.items.length} 首`;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { items?: unknown };
      return `${Array.isArray(raw?.items) ? raw.items.length : 0} 首`;
    } catch { return '0 首'; }
  }
}
