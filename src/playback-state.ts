import type { Track } from './state.ts';

export type PlaybackCueKind = 'paused' | 'resumed' | 'ended';
export interface PlaybackCue { kind: PlaybackCueKind; track?: Track }

const key = (track: Track) => JSON.stringify([track.title, track.artist, track.album]);

/** 播放器状态变化检测：只给暂停、恢复、结束三类，不重复。 */
export class PlaybackStateTracker {
  private lastStatus: Track['status'] | 'none' = 'none';
  private lastKey = '';
  private lastTrack?: Track;
  private lastSeenAt = 0;
  private statusSince = 0;
  private lastKind: PlaybackCueKind | '' = '';

  update(track: Track | null, now: number): PlaybackCue | null {
    if (!track) {
      if (this.lastTrack && this.lastStatus !== 'none' && this.lastKind !== 'ended' && this.lastKind !== 'paused'
        && now - this.lastSeenAt >= 5000) {
        const cue: PlaybackCue = { kind: 'ended', track: this.lastTrack };
        this.lastKind = 'ended';
        this.lastStatus = 'none';
        this.lastTrack = undefined;
        return cue;
      }
      return null;
    }
    const currentKey = key(track);
    if (currentKey !== this.lastKey) {
      this.lastKey = currentKey;
      this.lastTrack = track;
      this.lastStatus = track.status;
      this.lastSeenAt = now;
      this.statusSince = now;
      // 初始就是暂停时不补一句“暂停了”，等真正恢复再提示。
      this.lastKind = track.status === 'paused' ? 'paused' : '';
      return null;
    }
    this.lastSeenAt = now;
    this.lastTrack = track;
    if (track.status !== this.lastStatus) {
      this.lastStatus = track.status;
      this.statusSince = now;
      return null;
    }
    if (track.status === 'paused' && this.lastKind !== 'paused' && now - this.statusSince >= 2000) {
      this.lastKind = 'paused';
      return { kind: 'paused', track };
    }
    if (track.status === 'playing' && this.lastKind === 'paused' && now - this.statusSince >= 1000) {
      this.lastKind = 'resumed';
      return { kind: 'resumed', track };
    }
    return null;
  }
}
