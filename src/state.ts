import type { MusicConfig } from './config.ts';

export interface Track {
  title: string;
  artist: string;
  album: string;
  app: string;
  status: 'playing' | 'paused' | 'unknown';
  method: 'smtc' | 'window-title';
  positionSeconds?: number;
  durationSeconds?: number;
}
export interface Snapshot { track: Track | null; error?: string }
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
    status: t.status === 'playing' || t.status === 'paused' ? t.status : 'unknown',
    method: t.method as Track['method'],
    ...(typeof t.positionSeconds === 'number' && Number.isFinite(t.positionSeconds) && t.positionSeconds >= 0
      ? { positionSeconds: t.positionSeconds } : {}),
    ...(typeof t.durationSeconds === 'number' && Number.isFinite(t.durationSeconds) && t.durationSeconds > 0
      ? { durationSeconds: t.durationSeconds } : {}) } };
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
