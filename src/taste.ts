/**
 * 听歌口味档案：从 listening.json 的逐日历史汇总出常听歌手、循环曲、时段与播放器占比。
 * 单独存放在 dataDir/netease-companion/taste.json，是分析快照，不删除原始听歌记录。
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StoragePart } from 'cortico/core/types.ts';
import { matchPlayer } from './config.ts';
import type { CumulativeListening, ListeningHistory } from './listening.ts';

export interface TasteProfile {
  version: 1;
  updatedAt: string;
  windowDays: number;
  /** days：按逐日记录统计；cumulative：还没有逐日记录，用 listening.json 的累计排名兜底。 */
  scope: 'days' | 'cumulative';
  totalPlays: number;
  recordedDays: number;
  topArtists: Array<{ name: string; count: number }>;
  topGenres: Array<{ name: string; count: number; share: number }>;
  repeatTracks: Array<{ title: string; artist: string; count: number }>;
  hours: Array<{ hour: number; count: number }>;
  players: Array<{ app: string; count: number; share: number }>;
  tags: string[];
  summary: string;
}

const MAX_DAYS = 3650;
const clean = (value: unknown, max: number) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '';

/** 播放器占比沿用官方清单命名；未知进程仍保留原始名字。 */
const playerLabel = (app: string): string => matchPlayer(app)?.label ?? (app || '未知播放器');

/** 只从行为数据生成，不做人格判断。没有逐日记录时用累计排名兜底，时段与播放器留空。 */
export function buildTaste(history: ListeningHistory, windowDays: number, now = Date.now(),
  genreMap: ReadonlyMap<string, readonly string[]> = new Map(),
  cumulative?: CumulativeListening): TasteProfile {
  const days = history.days;
  const useDays = days.length > 0;
  const fallback = !useDays && cumulative && cumulative.totalPlays > 0 ? cumulative : null;
  const scope: TasteProfile['scope'] = useDays ? 'days' : 'cumulative';
  const totalPlays = useDays
    ? days.reduce((sum, day) => sum + day.plays, 0)
    : fallback?.totalPlays ?? 0;
  const artists = new Map<string, number>();
  const tracks = new Map<string, { title: string; artist: string; count: number }>();
  const genres = new Map<string, number>();
  const hours = Array(24).fill(0) as number[];
  const players = new Map<string, number>();
  const addTrack = (track: { title: string; artist: string; album: string; count: number }) => {
    const key = JSON.stringify([track.title, track.artist, track.album]);
    const found = tracks.get(key);
    if (found) found.count += track.count;
    else tracks.set(key, { title: track.title, artist: track.artist, count: track.count });
    for (const genre of genreMap.get(key) ?? []) genres.set(genre, (genres.get(genre) ?? 0) + track.count);
  };
  if (useDays) {
    for (const day of days) {
      for (const artist of day.artists) artists.set(artist.name, (artists.get(artist.name) ?? 0) + artist.count);
      for (const track of day.tracks) addTrack(track);
      for (let hour = 0; hour < 24; ++hour) hours[hour] += day.hours[hour] ?? 0;
      for (const player of day.players) players.set(player.app, (players.get(player.app) ?? 0) + player.count);
    }
  } else if (fallback) {
    for (const artist of fallback.artists) artists.set(artist.name, (artists.get(artist.name) ?? 0) + artist.count);
    for (const track of fallback.tracks) addTrack(track);
  }
  const topArtists = [...artists.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count }));
  const topGenres = [...genres.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([name, count]) => ({ name, count, share: totalPlays ? count / totalPlays : 0 }));
  const repeatTracks = [...tracks.values()].filter(track => track.count >= 2).sort((a, b) => b.count - a.count).slice(0, 8);
  const playerList = [...players.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([app, count]) => ({ app, count, share: totalPlays ? count / totalPlays : 0 }));
  const tags: string[] = [];
  if (totalPlays) {
    const night = [22, 23, 0, 1, 2, 3, 4, 5].reduce((sum, hour) => sum + hours[hour], 0);
    if (useDays && night / totalPlays >= 0.5) tags.push('夜间听歌');
    if (repeatTracks.length) tags.push('循环型');
    const topArtistShare = topArtists.length ? topArtists[0].count / totalPlays : 0;
    if (topArtists.length >= 3 && topArtistShare < 0.35) tags.push('多元歌手');
    else if (topArtists.length && topArtistShare >= 0.5) tags.push(`常听${topArtists[0].name}`);
    const topPlayer = playerList[0];
    if (topPlayer && topPlayer.share >= 0.8) tags.push(`常用${playerLabel(topPlayer.app)}`);
    if (topGenres[0]) tags.push(`曲风偏${topGenres[0].name}`);
    const peak = hours.reduce((best, count, hour) => count > best.count ? { count, hour } : best, { count: 0, hour: -1 });
    if (peak.count > 0) tags.push(`最活跃 ${String(peak.hour).padStart(2, '0')}:00`);
  }
  const windowLabel = windowDays >= MAX_DAYS ? '全部时间' : `最近 ${windowDays} 天`;
  const summary = totalPlays
    ? scope === 'cumulative'
      ? `累计共 ${totalPlays} 次播放，${topArtists[0] ? `最常听 ${topArtists[0].name}` : '还没有常听歌手'}；逐日记录从更新后开始。`
      : `${windowLabel}共 ${totalPlays} 次播放，${topArtists[0] ? `最常听 ${topArtists[0].name}` : '还没有常听歌手'}${playerList[0] ? `，常用 ${playerLabel(playerList[0].app)}` : ''}。`
    : '';
  return {
    version: 1, updatedAt: new Date(now).toISOString(), windowDays, scope, totalPlays,
    recordedDays: days.length, topArtists, topGenres, repeatTracks,
    hours: hours.map((count, hour) => ({ hour, count })), players: playerList,
    tags, summary,
  };
}

export class TasteStore {
  private data: TasteProfile | null = null;
  private chain: Promise<void> = Promise.resolve();
  constructor(private dir: string, private now: () => number = Date.now) {}

  get file(): string { return join(this.dir, 'taste.json'); }

  async read(): Promise<TasteProfile | null> {
    if (this.data) return this.data;
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as TasteProfile;
      if (raw && typeof raw.updatedAt === 'string' && Array.isArray(raw.topArtists)) {
        this.data = raw;
        return raw;
      }
    } catch {
      // 没有分析过。
    }
    return null;
  }

  refresh(history: ListeningHistory, windowDays: number, genreMap: ReadonlyMap<string, readonly string[]> = new Map(),
    cumulative?: CumulativeListening): Promise<TasteProfile> {
    const result = this.queue(async () => {
      const profile = buildTaste(history, windowDays, this.now(), genreMap, cumulative);
      await this.save(profile);
      return profile;
    });
    return result;
  }

  stat(): string {
    const label = (profile: TasteProfile | null) => profile
      ? `${profile.windowDays >= MAX_DAYS ? '全部' : `${profile.windowDays} 天`} · ${profile.totalPlays} 次`
      : '未分析';
    if (this.data) return label(this.data);
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as TasteProfile;
      return label(raw && typeof raw.updatedAt === 'string' ? raw : null);
    } catch { return '未分析'; }
  }

  async clear(): Promise<string> {
    await rm(this.file, { force: true });
    this.data = null;
    this.chain = Promise.resolve();
    return '已清除听歌口味档案';
  }

  storage(): StoragePart {
    return {
      key: 'taste', label: '听歌口味', kind: 'disk', location: this.file, danger: true,
      note: '只删除根据听歌历史生成的口味分析快照，不删除原始听歌记录、偏好画像、人格或会话。',
      stat: () => this.stat(),
      clear: () => this.clear(),
    };
  }

  private queue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(fn);
    this.chain = result.then(() => undefined, () => undefined);
    return result;
  }

  private async save(profile: TasteProfile): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(profile, null, 2), 'utf8');
    await rename(tmp, this.file);
    this.data = profile;
  }
}
