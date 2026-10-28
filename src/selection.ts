import { playerOrder } from './config.ts';
import type { SessionCandidate, Track, WindowCandidate } from './state.ts';

export type SelectionReason = 'sticky' | 'priority-playing' | 'priority-paused' | 'window-sticky' | 'window-priority';

export interface StickySelection {
  player: string;
  app: string;
  method: 'smtc' | 'window-title';
}

export interface Selection {
  track: Track;
  reason: SelectionReason;
  player: string;
  app: string;
  method: 'smtc' | 'window-title';
}

export interface SelectorState {
  sticky?: StickySelection;
  pending?: { player: string; app: string; count: number };
}

/**
 * 会话选择策略：优先级决定候选顺序，当前播放器有短暂粘性。
 * - 当前播放器仍在播放时，高优先级播放器需要连续出现若干次才切换，避免瞬时会话造成抖动。
 * - 当前播放器已暂停或消失时，立即按优先级切换。
 * - 同一播放器有多个会话时优先保持已选中的那个。
 */
export class TrackSelector {
  private sticky?: StickySelection;
  private pending?: { player: string; app: string; count: number };

  constructor(private readonly settleTicks = 2) {}

  reset(): void {
    this.sticky = undefined;
    this.pending = undefined;
  }

  state(): SelectorState {
    return {
      ...(this.sticky ? { sticky: { ...this.sticky } } : {}),
      ...(this.pending ? { pending: { ...this.pending } } : {}),
    };
  }

  select(priorityInput: readonly string[], sessions: readonly SessionCandidate[], windows: readonly WindowCandidate[]): Selection | null {
    const priority = playerOrder(priorityInput);
    const rank = new Map(priority.map((id, index) => [id, index]));
    const ordered = sessions
      .filter(item => rank.has(item.player) && item.title)
      .sort((a, b) => (rank.get(a.player)! - rank.get(b.player)!) || a.app.localeCompare(b.app));
    if (ordered.length) return this.pickSession(priority, rank, ordered);
    const orderedWindows = windows
      .filter(item => rank.has(item.player) && item.title)
      .sort((a, b) => (rank.get(a.player)! - rank.get(b.player)!) || a.app.localeCompare(b.app));
    if (orderedWindows.length) return this.pickWindow(orderedWindows);
    this.reset();
    return null;
  }

  private pickSession(priority: readonly string[], rank: Map<string, number>, ordered: readonly SessionCandidate[]): Selection {
    let best: SessionCandidate | null = null;
    let reason: SelectionReason = 'priority-playing';
    for (const player of priority) {
      const playing = ordered.filter(item => item.player === player && item.status === 'playing');
      if (playing.length) { best = this.preferSession(playing); reason = 'priority-playing'; break; }
    }
    if (!best) {
      for (const player of priority) {
        const candidates = ordered.filter(item => item.player === player);
        if (candidates.length) { best = this.preferSession(candidates); reason = 'priority-paused'; break; }
      }
    }
    if (!best) throw new Error('selection: no session candidate');

    const sticky = this.sticky?.method === 'smtc'
      ? ordered.find(item => item.player === this.sticky!.player && item.app === this.sticky!.app)
      : undefined;
    if (!sticky) return this.adoptSession(best, reason);
    if (sticky.player === best.player && sticky.app === best.app) {
      this.pending = undefined;
      return this.keepSession(sticky);
    }
    if (sticky.status !== 'playing') return this.adoptSession(best, reason);

    const stickyRank = rank.get(sticky.player)!;
    const bestRank = rank.get(best.player)!;
    if (best.status !== 'playing' || bestRank > stickyRank) {
      this.pending = undefined;
      return this.keepSession(sticky);
    }
    // Higher-priority player is now playing; wait for a short streak before switching.
    this.pending = this.pending && this.pending.player === best.player && this.pending.app === best.app
      ? { ...this.pending, count: this.pending.count + 1 }
      : { player: best.player, app: best.app, count: 1 };
    if (this.pending.count < Math.max(1, this.settleTicks)) return this.keepSession(sticky);
    return this.adoptSession(best, reason);
  }

  private pickWindow(ordered: readonly WindowCandidate[]): Selection {
    const sticky = this.sticky?.method === 'window-title'
      ? ordered.find(item => item.player === this.sticky!.player && item.app === this.sticky!.app)
      : undefined;
    return sticky ? this.keepWindow(sticky) : this.adoptWindow(ordered[0]);
  }

  private preferSession(candidates: readonly SessionCandidate[]): SessionCandidate {
    if (this.sticky?.method === 'smtc') {
      const hit = candidates.find(item => item.player === this.sticky!.player && item.app === this.sticky!.app);
      if (hit) return hit;
    }
    return candidates[0];
  }

  private adoptSession(candidate: SessionCandidate, reason: SelectionReason): Selection {
    this.pending = undefined;
    this.sticky = { player: candidate.player, app: candidate.app, method: 'smtc' };
    return this.sessionSelection(candidate, reason);
  }

  private keepSession(candidate: SessionCandidate): Selection {
    this.sticky = { player: candidate.player, app: candidate.app, method: 'smtc' };
    return this.sessionSelection(candidate, 'sticky');
  }

  private sessionSelection(candidate: SessionCandidate, reason: SelectionReason): Selection {
    return {
      reason, player: candidate.player, app: candidate.app, method: 'smtc',
      track: {
        title: candidate.title, artist: candidate.artist, album: candidate.album,
        app: candidate.app, player: candidate.player, status: candidate.status,
        method: 'smtc', timeline: candidate.timeline,
        ...(candidate.positionSeconds !== undefined ? { positionSeconds: candidate.positionSeconds } : {}),
        ...(candidate.durationSeconds !== undefined ? { durationSeconds: candidate.durationSeconds } : {}),
      },
    };
  }

  private adoptWindow(candidate: WindowCandidate): Selection {
    this.pending = undefined;
    this.sticky = { player: candidate.player, app: candidate.app, method: 'window-title' };
    return this.windowSelection(candidate, 'window-priority');
  }

  private keepWindow(candidate: WindowCandidate): Selection {
    this.sticky = { player: candidate.player, app: candidate.app, method: 'window-title' };
    return this.windowSelection(candidate, 'window-sticky');
  }

  private windowSelection(candidate: WindowCandidate, reason: SelectionReason): Selection {
    return {
      reason, player: candidate.player, app: candidate.app, method: 'window-title',
      track: {
        title: candidate.title, artist: '', album: '', app: candidate.app, player: candidate.player,
        status: 'unknown', method: 'window-title', timeline: false,
      },
    };
  }
}
