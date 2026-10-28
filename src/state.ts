import type { MusicConfig } from './config.ts';

export interface Track {
  title: string;
  artist: string;
  album: string;
  app: string;
  /** 官方播放器 id；窗口标题兜底时也能标出来源。 */
  player?: string;
  status: 'playing' | 'paused' | 'unknown';
  method: 'smtc' | 'window-title';
  /** 播放器是否提供了播放位置/时长；false 表示分段只能按时间估算。 */
  timeline?: boolean;
  positionSeconds?: number;
  durationSeconds?: number;
}
export interface Snapshot { track: Track | null; error?: string }
/** 读取脚本上报的单个 SMTC 会话；选择由 TypeScript 侧完成。 */
export interface SessionCandidate {
  app: string;
  player: string;
  status: 'playing' | 'paused' | 'unknown';
  title: string;
  artist: string;
  album: string;
  timeline: boolean;
  positionSeconds?: number;
  durationSeconds?: number;
}
/** SMTC 不可用时的窗口标题候选。 */
export interface WindowCandidate { app: string; player: string; title: string }
export interface MediaCandidates { sessions: SessionCandidate[]; windows: WindowCandidate[]; error?: string }
const clean = (s: unknown) => typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300) : '';
export function parseSnapshot(input: unknown): Snapshot {
  if (!input || typeof input !== 'object') throw new Error('Invalid media snapshot');
  const raw = input as Record<string, unknown>;
  if (raw.track === null) return { track: null, error: clean(raw.error) || undefined };
  if (!raw.track || typeof raw.track !== 'object') throw new Error('Missing track');
  const t = raw.track as Record<string, unknown>;
  const title = clean(t.title);
  if (!title || !['smtc', 'window-title'].includes(String(t.method))) throw new Error('Invalid track');
  return { track: { title, artist: clean(t.artist), album: clean(t.album), app: clean(t.app),
    ...(typeof t.player === 'string' && t.player ? { player: clean(t.player) } : {}),
    status: t.status === 'playing' || t.status === 'paused' ? t.status : 'unknown',
    method: t.method as Track['method'],
    ...(typeof t.timeline === 'boolean' ? { timeline: t.timeline } : {}),
    ...(typeof t.positionSeconds === 'number' && Number.isFinite(t.positionSeconds) && t.positionSeconds >= 0
      ? { positionSeconds: t.positionSeconds } : {}),
    ...(typeof t.durationSeconds === 'number' && Number.isFinite(t.durationSeconds) && t.durationSeconds > 0
      ? { durationSeconds: t.durationSeconds } : {}) } };
}
const candidateNumber = (value: unknown, min: number): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= min ? value : undefined;
/** 解析读取脚本上报的全部会话与窗口候选；选择策略在 TrackSelector 里。 */
export function parseCandidates(input: unknown): MediaCandidates {
  if (!input || typeof input !== 'object') throw new Error('Invalid media candidates');
  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw.sessions) && !Array.isArray(raw.windowCandidates)) throw new Error('Missing media candidates');
  const sessions: SessionCandidate[] = [];
  for (const item of (Array.isArray(raw.sessions) ? raw.sessions : []).slice(0, 16)) {
    if (!item || typeof item !== 'object') continue;
    const value = item as Record<string, unknown>;
    const title = clean(value.title);
    const player = clean(value.player);
    const app = clean(value.app);
    if (!title || !player || !app) continue;
    sessions.push({
      title, player, app,
      artist: clean(value.artist), album: clean(value.album),
      status: value.status === 'playing' || value.status === 'paused' ? value.status : 'unknown',
      timeline: value.timeline === true,
      ...(candidateNumber(value.positionSeconds, 0) !== undefined
        ? { positionSeconds: candidateNumber(value.positionSeconds, 0) } : {}),
      ...(candidateNumber(value.durationSeconds, 0.001) !== undefined
        ? { durationSeconds: candidateNumber(value.durationSeconds, 0.001) } : {}),
    });
  }
  const windows: WindowCandidate[] = [];
  for (const item of (Array.isArray(raw.windowCandidates) ? raw.windowCandidates : []).slice(0, 16)) {
    if (!item || typeof item !== 'object') continue;
    const value = item as Record<string, unknown>;
    const title = clean(value.title);
    const player = clean(value.player);
    const app = clean(value.app);
    if (title && player && app) windows.push({ title, player, app });
  }
  return { sessions, windows, ...(clean(raw.error) ? { error: clean(raw.error) } : {}) };
}
const key = (t: Track) => JSON.stringify([t.title, t.artist, t.album]);
const seconds = (v: number, fallback: number, min: number, max: number) =>
  Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;

/** Keep the latest observation; never enqueue comments for tracks already skipped. */
export class ListeningState {
  current: Track | null = null;
  observedAt = 0;
  history: Array<{ track: Track; at: string }> = [];
  private candidateSince = 0;
  private offeredKey = '';
  private lastOffer = -Infinity;
  revision = 0;
  private recentOffers = new Map<string, number>();
  update(track: Track | null, now: number): void {
    if (now < this.observedAt) {
      this.lastOffer = -Infinity;
      this.recentOffers.clear();
      this.offeredKey = '';
    }
    const changed = (track ? key(track) : '') !== (this.current ? key(this.current) : '');
    const gap = this.observedAt > 0 && (now - this.observedAt > 10_000 || now < this.observedAt);
    const statusChanged = this.current?.status !== track?.status;
    const elapsed = Math.max(0, (now - this.observedAt) / 1000);
    const before = this.current?.positionSeconds, after = track?.positionSeconds;
    const seek = !changed && before !== undefined && after !== undefined &&
      Math.abs(after - before - (this.current?.status === 'playing' ? elapsed : 0)) > 5;
    if (changed || gap || statusChanged || seek) {
      ++this.revision;
      this.candidateSince = now;
    }
    if (changed) {
      this.offeredKey = '';
      if (track) this.history = [...this.history, { track, at: new Date(now).toISOString() }].slice(-20);
    }
    // Resume waits again so a paused song does not immediately trigger a comment.
    if (this.current?.status === 'paused' && track?.status !== 'paused') this.candidateSince = now;
    this.current = track;
    this.observedAt = now;
  }
  offer(cfg: MusicConfig, now: number): Track | null {
    const t = this.current;
    if (!this.ready(cfg, now) || !t || this.offeredKey === key(t)) return null;
    const recent = this.recentOffers.get(key(t));
    if (recent !== undefined && now - recent < 10 * 60_000) return null;
    if (now - this.lastOffer < seconds(cfg.cooldownSeconds, 120, 30, 3600) * 1000) return null;
    return t;
  }
  ready(cfg: MusicConfig, now: number): boolean {
    return cfg.commentary === true && !!this.current && this.current.status !== 'paused' &&
      now >= this.observedAt && now - this.observedAt <= 10_000 &&
      now - this.candidateSince >= seconds(cfg.settleSeconds, 8, 2, 120) * 1000;
  }
  /** 当前这首是否已经有过开场评论；同曲分段只在这之后触发。 */
  hasOffered(track: Track): boolean {
    return this.offeredKey === key(track);
  }
  /** 与 offer 相同的时间/间隔检查，但不看“本首已评论过”，供同曲分段使用。 */
  canOffer(cfg: MusicConfig, now: number): boolean {
    return this.ready(cfg, now) &&
      now - this.lastOffer >= seconds(cfg.cooldownSeconds, 120, 30, 3600) * 1000;
  }
  commit(t: Track, revision: number, now: number): boolean {
    if (!this.current || this.revision !== revision || key(t) !== key(this.current)) return false;
    this.offeredKey = key(t);
    this.lastOffer = now;
    this.recentOffers.delete(key(t));
    this.recentOffers.set(key(t), now);
    while (this.recentOffers.size > 100) this.recentOffers.delete(this.recentOffers.keys().next().value!);
    return true;
  }
}
