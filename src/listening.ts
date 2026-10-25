/**
 * 本机听歌记忆：按歌名、歌手、专辑聚合出现次数，并维护歌曲/歌手排名。
 * 独立文件 dataDir/netease-companion/listening.json，不写入人格、会话或其他插件的记忆。
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StoragePart } from 'cortico/core/types.ts';
import type { Track } from './state.ts';

export interface ListeningLimits { tracks: number; artists: number; rankTracks?: number; rankArtists?: number }
export interface ResolvedListeningLimits { tracks: number; artists: number; rankTracks: number; rankArtists: number }
export interface ListeningTrack {
  title: string;
  artist: string;
  album: string;
  count: number;
  firstAt: string;
  lastAt: string;
}
export interface ListeningArtist {
  name: string;
  count: number;
  lastAt: string;
}
export interface RankedTrack {
  rank: number;
  title: string;
  artist: string;
  count: number;
  lastAt: string;
}
export interface RankedArtist {
  rank: number;
  name: string;
  count: number;
  lastAt: string;
}
export interface ListeningRanking {
  totalPlays: number;
  storedTracks: number;
  storedArtists: number;
  limits: ResolvedListeningLimits;
  tracks: RankedTrack[];
  artists: RankedArtist[];
}
export interface ListeningMemoryView {
  totalPlays: number;
  trackCount: number;
  artistCount: number;
  topArtists: Array<{ name: string; count: number; lastAt: string }>;
  topTracks: Array<{ title: string; artist: string; count: number; lastAt: string }>;
  recentTracks: Array<{ title: string; artist: string; album: string; count: number; lastAt: string }>;
  summary: string;
}
export interface ListeningRelation {
  track?: { count: number; lastAt: string };
  artist?: { name: string; count: number; lastAt: string };
}

/** 配置文件允许的上限；读取旧文件时也只保留这么多，防止异常文件拖慢界面。 */
const ABSOLUTE_MAX_TRACKS = 500;
const ABSOLUTE_MAX_ARTISTS = 100;
const MAX_FIELD = 200;
const MAX_SUMMARY = 220;
const DWELL_SECONDS = 10;
/** 曲目在切换或关闭播放器前至少稳定这么久，才算一次听歌记录。 */
export const LISTENING_DWELL_MS = DWELL_SECONDS * 1000;

interface Data {
  totalPlays: number;
  tracks: ListeningTrack[];
  artists: ListeningArtist[];
}

const text = (v: unknown) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, MAX_FIELD) : '';
const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const key = (title: string, artist: string, album: string) => `${norm(title)}\u0000${norm(artist)}\u0000${norm(album)}`;
const bounded = (value: number, fallback: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.floor(Math.max(min, Math.min(max, value))) : fallback;

function validTrack(v: unknown): v is ListeningTrack {
  const t = v as ListeningTrack | null;
  return !!t && typeof t.title === 'string' && t.title.length > 0
    && typeof t.artist === 'string' && typeof t.album === 'string'
    && Number.isFinite(t.count) && t.count > 0
    && typeof t.firstAt === 'string' && typeof t.lastAt === 'string';
}
function validArtist(v: unknown): v is ListeningArtist {
  const a = v as ListeningArtist | null;
  return !!a && typeof a.name === 'string' && a.name.length > 0
    && Number.isFinite(a.count) && a.count > 0 && typeof a.lastAt === 'string';
}

/**
 * 单曲循环计数：优先用 SMTC 播放位置从结尾回到开头的跳变；
 * 没有位置时按播放中的实际时间累计，每满一个曲目时长记一次。
 */
export class ReplayCounter {
  private key = '';
  private playMs = 0;
  private lastAt = 0;
  private lastPos?: number;
  private positionSeen = false;
  reset(key: string, track: Track, now: number): void {
    this.key = key;
    const pos = track.positionSeconds;
    this.playMs = pos !== undefined && pos > 0 ? pos * 1000 : 0;
    this.lastAt = now;
    this.lastPos = pos;
    this.positionSeen = pos !== undefined && pos > 0;
  }
  update(key: string, track: Track, durationMs: number, now: number): number {
    if (key !== this.key) { this.reset(key, track, now); return 0; }
    const delta = now - this.lastAt;
    this.lastAt = now;
    if (track.status !== 'playing') return 0;
    const gap = delta <= 0 || delta > 5000;
    const pos = track.positionSeconds;
    if (pos !== undefined && pos > 0 && !this.positionSeen) {
      this.positionSeen = true;
      this.playMs = pos * 1000;
      this.lastPos = pos;
      return 0;
    }
    if (this.positionSeen && pos !== undefined) {
      if (this.lastPos !== undefined && this.lastPos > 5 && pos + 3 < this.lastPos) {
        const replay = durationMs >= 30_000 && this.lastPos * 1000 >= durationMs * 0.5 && pos <= 5 ? 1 : 0;
        this.playMs = pos * 1000;
        this.lastPos = pos;
        return replay;
      }
      this.lastPos = pos;
      return 0;
    }
    if (gap || !durationMs || durationMs < 30_000) return 0;
    this.playMs += delta;
    let replays = 0;
    while (this.playMs >= durationMs) { this.playMs -= durationMs; replays++; }
    return replays;
  }
}

export class ListeningMemoryStore {
  private data: Data | null = null;
  private chain: Promise<void> = Promise.resolve();
  constructor(private dir: string,
    private limits: () => ListeningLimits = () => ({ tracks: 100, artists: 30 }),
    private random: () => number = Math.random) {}

  get file(): string { return join(this.dir, 'listening.json'); }

  private limitsNow(): ResolvedListeningLimits {
    const raw = this.limits();
    const tracks = bounded(raw.tracks, 100, 10, 500);
    const artists = bounded(raw.artists, 30, 5, 100);
    return {
      tracks, artists,
      rankTracks: Math.min(tracks, bounded(raw.rankTracks ?? tracks, tracks, 1, 500)),
      rankArtists: Math.min(artists, bounded(raw.rankArtists ?? artists, artists, 1, 100)),
    };
  }

  private async load(): Promise<Data> {
    if (this.data) return this.data;
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8'));
      const tracks = (Array.isArray(raw?.tracks) ? raw.tracks.filter(validTrack) : [])
        .sort((a: ListeningTrack, b: ListeningTrack) => b.count - a.count || b.lastAt.localeCompare(a.lastAt))
        .slice(0, ABSOLUTE_MAX_TRACKS);
      const artists = (Array.isArray(raw?.artists) ? raw.artists.filter(validArtist) : [])
        .sort((a: ListeningArtist, b: ListeningArtist) => b.count - a.count || b.lastAt.localeCompare(a.lastAt))
        .slice(0, ABSOLUTE_MAX_ARTISTS);
      this.data = {
        totalPlays: Number.isFinite(raw?.totalPlays) ? Math.max(0, Math.floor(raw.totalPlays)) : 0,
        tracks, artists,
      };
    } catch {
      this.data = { totalPlays: 0, tracks: [], artists: [] };
    }
    return this.data;
  }

  /** 记录一次稳定收听。失败时静默返回 false，不影响播放器读取。 */
  async record(track: { title?: string; artist?: string; album?: string }, at = Date.now(), count = 1): Promise<boolean> {
    const title = text(track.title);
    if (!title) return false;
    const artist = text(track.artist), album = text(track.album);
    const times = Math.max(1, Math.min(100, Math.floor(Number.isFinite(count) ? count : 1)));
    const atIso = new Date(at).toISOString();
    try {
      await this.queue(async () => {
        const data = await this.load();
        const limits = this.limitsNow();
        const k = key(title, artist, album);
        const existing = data.tracks.find(t => key(t.title, t.artist, t.album) === k);
        if (existing) {
          existing.count += times;
          existing.lastAt = atIso;
          existing.title = title;
          existing.artist = artist;
          existing.album = album;
        } else {
          data.tracks.push({ title, artist, album, count: times, firstAt: atIso, lastAt: atIso });
        }
        const artistKey = artist ? norm(artist) : '';
        if (artist) {
          const found = data.artists.find(a => norm(a.name) === artistKey);
          if (found) { found.count += times; found.lastAt = atIso; found.name = artist; }
          else data.artists.push({ name: artist, count: times, lastAt: atIso });
        }
        data.totalPlays += times;
        this.trimTracks(data, limits.tracks, k);
        this.trimArtists(data, limits.artists, artistKey);
        data.tracks.sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
        data.artists.sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
        await this.save(data);
      });
      return true;
    } catch { return false; }
  }

  /**
   * 超过歌曲上限时，从「当前曲目以外」的旧记录里淘汰分数最低的一首：
   * 分数 = 歌曲播放次数 + 该歌手出现次数。同分随机；刚播放的这首先保留，让它有机会积累次数。
   */
  private trimTracks(data: Data, max: number, currentKey: string): void {
    while (data.tracks.length > max) {
      const candidates = data.tracks
        .filter(t => key(t.title, t.artist, t.album) !== currentKey)
        .sort((a, b) => a.lastAt.localeCompare(b.lastAt));
      if (!candidates.length) break;
      const artistCounts = new Map(data.artists.map(a => [norm(a.name), a.count]));
      const score = (t: ListeningTrack) => t.count + (artistCounts.get(norm(t.artist)) ?? 0);
      const min = Math.min(...candidates.map(score));
      const pool = candidates.filter(t => score(t) === min);
      const drop = pool[this.pickIndex(pool.length)];
      data.tracks = data.tracks.filter(t => t !== drop);
    }
  }

  /** 歌手超过上限时，同样保护刚出现的歌手，从旧记录里淘汰出现次数最低的一位；同分随机。 */
  private trimArtists(data: Data, max: number, currentKey: string): void {
    while (data.artists.length > max) {
      const candidates = data.artists
        .filter(a => norm(a.name) !== currentKey)
        .sort((a, b) => a.lastAt.localeCompare(b.lastAt));
      if (!candidates.length) break;
      const min = Math.min(...candidates.map(a => a.count));
      const pool = candidates.filter(a => a.count === min);
      const drop = pool[this.pickIndex(pool.length)];
      data.artists = data.artists.filter(a => a !== drop);
    }
  }

  private pickIndex(length: number): number {
    if (length <= 1) return 0;
    const value = this.random();
    const normalized = Number.isFinite(value) ? Math.max(0, Math.min(0.999999, value)) : 0;
    return Math.floor(normalized * length);
  }

  async view(recentLimit = 8): Promise<ListeningMemoryView> {
    const data = await this.load();
    const limits = this.limitsNow();
    const storedTracks = Math.min(data.tracks.length, limits.tracks);
    const storedArtists = Math.min(data.artists.length, limits.artists);
    const rankedTracks = [...data.tracks]
      .sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt))
      .slice(0, limits.rankTracks);
    const rankedArtists = [...data.artists]
      .sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt))
      .slice(0, limits.rankArtists);
    const topArtists = rankedArtists.slice(0, 8).map(a => ({ name: a.name, count: a.count, lastAt: a.lastAt }));
    const topTracks = rankedTracks.slice(0, 5).map(t => ({ title: t.title, artist: t.artist, count: t.count, lastAt: t.lastAt }));
    const recentTracks = [...rankedTracks]
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
      .slice(0, Math.max(1, Math.floor(recentLimit)))
      .map(t => ({ title: t.title, artist: t.artist, album: t.album, count: t.count, lastAt: t.lastAt }));
    const artists = topArtists.slice(0, 3).map(a => `${a.name}（${a.count} 次）`).join('、');
    const recent = recentTracks.slice(0, 3).map(t => t.title).join('、');
    const summary = data.totalPlays
      ? `累计记录 ${data.totalPlays} 次播放、${storedTracks} 首歌${artists ? `；常听歌手：${artists}` : ''}${recent ? `；最近：${recent}` : ''}`.slice(0, MAX_SUMMARY)
      : '';
    return {
      totalPlays: data.totalPlays, trackCount: storedTracks, artistCount: storedArtists,
      topArtists, topTracks, recentTracks, summary,
    };
  }

  /** 供「一起听排名」面板读取：按出现次数排序，并分别套用收录上限与显示范围。 */
  async ranking(): Promise<ListeningRanking> {
    const data = await this.load();
    const limits = this.limitsNow();
    const storedTracks = Math.min(data.tracks.length, limits.tracks);
    const storedArtists = Math.min(data.artists.length, limits.artists);
    const tracks = [...data.tracks]
      .sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt))
      .slice(0, limits.rankTracks)
      .map((t, i) => ({ rank: i + 1, title: t.title, artist: t.artist, count: t.count, lastAt: t.lastAt }));
    const artists = [...data.artists]
      .sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt))
      .slice(0, limits.rankArtists)
      .map((a, i) => ({ rank: i + 1, name: a.name, count: a.count, lastAt: a.lastAt }));
    return { totalPlays: data.totalPlays, storedTracks, storedArtists, limits, tracks, artists };
  }

  async relation(track: { title?: string; artist?: string; album?: string }): Promise<ListeningRelation> {
    const data = await this.load();
    const title = text(track.title), artist = text(track.artist), album = text(track.album);
    const found = title ? data.tracks.find(t => key(t.title, t.artist, t.album) === key(title, artist, album)) : undefined;
    const foundArtist = artist ? data.artists.find(a => norm(a.name) === norm(artist)) : undefined;
    return {
      ...(found ? { track: { count: found.count, lastAt: found.lastAt } } : {}),
      ...(foundArtist ? { artist: { name: foundArtist.name, count: foundArtist.count, lastAt: foundArtist.lastAt } } : {}),
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
    await writeFile(tmp, JSON.stringify({
      version: 1, updatedAt: new Date().toISOString(), totalPlays: data.totalPlays,
      tracks: data.tracks, artists: data.artists,
    }, null, 2), 'utf8');
    await rename(tmp, this.file);
    this.data = data;
  }

  stat(): string {
    const label = (data: Data | null) => {
      if (!data) return '0 首';
      const limits = this.limitsNow();
      return `${Math.min(data.tracks.length, limits.tracks)} 首 / ${Math.min(data.artists.length, limits.artists)} 位歌手`;
    };
    if (this.data) return label(this.data);
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8'));
      return label({
        totalPlays: 0,
        tracks: Array.isArray(raw?.tracks) ? raw.tracks.filter(validTrack).slice(0, ABSOLUTE_MAX_TRACKS) : [],
        artists: Array.isArray(raw?.artists) ? raw.artists.filter(validArtist).slice(0, ABSOLUTE_MAX_ARTISTS) : [],
      });
    } catch { return '0 首'; }
  }

  async clear(): Promise<string> {
    await rm(this.file, { force: true });
    this.data = { totalPlays: 0, tracks: [], artists: [] };
    this.chain = Promise.resolve();
    return '已清除听歌记忆';
  }

  storage(): StoragePart {
    return {
      key: 'listening', label: '听歌记忆', kind: 'disk', location: this.file, danger: true,
      note: '只删除本机记录的听歌历史（歌名、歌手、专辑、次数与排名），不影响偏好画像、人格或会话。',
      stat: () => this.stat(),
      clear: () => this.clear(),
    };
  }
}
