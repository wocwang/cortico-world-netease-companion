/**
 * 听歌口味档案：从 listening.json 的逐日历史汇总出常听歌手、循环曲、时段与播放器占比。
 * 单独存放在 dataDir/netease-companion/taste.json，是分析快照，不删除原始听歌记录。
 */
import { rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StoragePart } from 'cortico/core/types.ts';
import { matchPlayer } from './config.ts';
import type { CumulativeListening, ListeningHistory } from './listening.ts';
import { dirValue, readDirs, writeTextWithFallback, type DirRef } from './storage.ts';

export interface TasteProfile {
  version: 1;
  updatedAt: string;
  windowDays: number;
  /** days：按逐日记录统计；mixed：逐日记录 + 更新前只留下的累计排名；cumulative：还没有逐日记录，全部用累计排名兜底。 */
  scope: 'days' | 'mixed' | 'cumulative';
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
  const dayPlays = days.reduce((sum, day) => sum + day.plays, 0);
  const fallback = !useDays && cumulative && cumulative.totalPlays > 0 ? cumulative : null;
  /** 逐日记录出现之前只留下了累计排名；把它补进统计，避免升级后画像突然从零开始。 */
  const earlierPlays = useDays && cumulative ? Math.max(0, cumulative.totalPlays - dayPlays) : 0;
  const scope: TasteProfile['scope'] = useDays ? (earlierPlays > 0 ? 'mixed' : 'days') : 'cumulative';
  const totalPlays = useDays ? dayPlays + earlierPlays : fallback?.totalPlays ?? 0;
  const artists = new Map<string, number>();
  const tracks = new Map<string, { title: string; artist: string; count: number }>();
  const genres = new Map<string, number>();
  const hours = Array(24).fill(0) as number[];
  const players = new Map<string, number>();
  const dayTrackCounts = new Map<string, number>();
  const dayArtistCounts = new Map<string, number>();
  const normArtist = (name: string) => name.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  /** 曲风占比只用有曲风标签的播放做分母；更新前没有曲风信息的播放不参与。 */
  let genrePlays = 0;
  const addTrack = (track: { title: string; artist: string; album: string; count: number }) => {
    const key = JSON.stringify([track.title, track.artist, track.album]);
    const found = tracks.get(key);
    if (found) found.count += track.count;
    else tracks.set(key, { title: track.title, artist: track.artist, count: track.count });
    const trackGenres = genreMap.get(key) ?? [];
    if (trackGenres.length) genrePlays += track.count;
    for (const genre of trackGenres) genres.set(genre, (genres.get(genre) ?? 0) + track.count);
  };
  if (useDays) {
    for (const day of days) {
      for (const artist of day.artists) {
        artists.set(artist.name, (artists.get(artist.name) ?? 0) + artist.count);
        dayArtistCounts.set(normArtist(artist.name), (dayArtistCounts.get(normArtist(artist.name)) ?? 0) + artist.count);
      }
      for (const track of day.tracks) {
        const key = JSON.stringify([track.title, track.artist, track.album]);
        dayTrackCounts.set(key, (dayTrackCounts.get(key) ?? 0) + track.count);
        addTrack(track);
      }
      for (let hour = 0; hour < 24; ++hour) hours[hour] += day.hours[hour] ?? 0;
      for (const player of day.players) {
        const app = (player.app ?? '').trim();
        // 旧记录或读取失败时的 unknown 不代表真实客户端，不参与占比。
        if (!app || app === 'unknown') continue;
        players.set(app, (players.get(app) ?? 0) + player.count);
      }
    }
    if (earlierPlays > 0 && cumulative) {
      for (const track of cumulative.tracks) {
        const extra = track.count - (dayTrackCounts.get(JSON.stringify([track.title, track.artist, track.album])) ?? 0);
        if (extra > 0) addTrack({ ...track, count: extra });
      }
      for (const artist of cumulative.artists) {
        const extra = artist.count - (dayArtistCounts.get(normArtist(artist.name)) ?? 0);
        if (extra > 0) artists.set(artist.name, (artists.get(artist.name) ?? 0) + extra);
      }
    }
  } else if (fallback) {
    for (const artist of fallback.artists) artists.set(artist.name, (artists.get(artist.name) ?? 0) + artist.count);
    for (const track of fallback.tracks) addTrack(track);
  }
  const topArtists = [...artists.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count }));
  const topGenres = [...genres.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([name, count]) => ({ name, count, share: genrePlays ? count / genrePlays : 0 }));
  const repeatTracks = [...tracks.values()].filter(track => track.count >= 2).sort((a, b) => b.count - a.count).slice(0, 8);
  const playerPlays = [...players.values()].reduce((sum, count) => sum + count, 0);
  const playerList = [...players.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([app, count]) => ({ app, count, share: playerPlays ? count / playerPlays : 0 }));
  const tags: string[] = [];
  if (totalPlays) {
    const night = [22, 23, 0, 1, 2, 3, 4, 5].reduce((sum, hour) => sum + hours[hour], 0);
    // 时段只来自逐日记录，比例也用逐日播放数作分母，避免被更新前的累计播放稀释。
    if (useDays && night / Math.max(1, dayPlays) >= 0.5) tags.push('夜间听歌');
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
      : `${windowLabel}共 ${totalPlays} 次播放${scope === 'mixed' ? `（其中 ${earlierPlays} 次来自更新前的累计记录）` : ''}，${topArtists[0] ? `最常听 ${topArtists[0].name}` : '还没有常听歌手'}${playerList[0] ? `，常用 ${playerLabel(playerList[0].app)}` : ''}${scope === 'mixed' ? '；播放器与曲风占比只统计有记录的部分' : ''}。`
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
  private local?: DirRef;
  constructor(private dir: DirRef, private now: () => number = Date.now) {}

  /** 口味是分析快照，不合并两处：当前目录有就用它，没有才读本机旧快照。 */
  useLocal(dir: DirRef): this { this.local = dir; return this; }

  resetCache(): void { this.data = null; }

  get file(): string { return join(dirValue(this.dir), 'taste.json'); }

  async read(): Promise<TasteProfile | null> {
    if (this.data) return this.data;
    for (const dir of readDirs(this.dir, this.local)) {
      try {
        const raw = JSON.parse(readFileSync(join(dir, 'taste.json'), 'utf8')) as TasteProfile;
        if (raw && typeof raw.updatedAt === 'string' && Array.isArray(raw.topArtists)) {
          this.data = raw;
          return raw;
        }
      } catch {
        // 这一处没有快照或内容损坏，继续看下一处。
      }
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
    await writeTextWithFallback(dirValue(this.dir), this.local ? dirValue(this.local) : '', 'taste.json',
      JSON.stringify(profile, null, 2));
    this.data = profile;
  }
}
