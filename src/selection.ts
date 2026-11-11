import { isAutoPlayer, isBlacklistedApp, playerOrder } from './config.ts';
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
/** 通用识别：清单外的播放器是否参与、用户黑名单，以及从连接检查保存的播放器。 */
export interface AutoOptions {
  enabled: boolean;
  blacklist: readonly string[];
  /** 用户保存的清单外播放器 id（auto:<短名>），按已支持播放器对待并排在官方项之后。 */
  saved?: readonly string[];
}

/** 未知播放器「最近一次在播」的记忆时长：超过后不再影响通用识别的排序。 */
const AUTO_MEMORY_MS = 30 * 60_000;

/**
 * 会话选择策略：优先级决定候选顺序，当前播放器有短暂粘性。
 * - 当前播放器仍在播放时，高优先级播放器需要连续出现若干次才切换，避免瞬时会话造成抖动。
 * - 当前播放器已暂停或消失时，立即按优先级切换。
 * - 同一播放器有多个会话时优先保持已选中的那个。
 */
export class TrackSelector {
  private sticky?: StickySelection;
  private pending?: { player: string; app: string; count: number };
  /** 通用识别：未知播放器 → 最近一次看到它在播放的时间。 */
  private readonly autoSeen = new Map<string, number>();
  /** 上一轮参与候选的未知播放器，用于识别 paused→playing 的重新开始。 */
  private autoPrev = new Set<string>();

  constructor(private readonly settleTicks = 2) {}

  reset(): void {
    this.sticky = undefined;
    this.pending = undefined;
    this.autoSeen.clear();
    this.autoPrev.clear();
  }

  state(): SelectorState {
    return {
      ...(this.sticky ? { sticky: { ...this.sticky } } : {}),
      ...(this.pending ? { pending: { ...this.pending } } : {}),
    };
  }

  select(
    priorityInput: readonly string[],
    sessions: readonly SessionCandidate[],
    windows: readonly WindowCandidate[],
    auto: AutoOptions = { enabled: false, blacklist: [] },
  ): Selection | null {
    // 已保存的未知播放器按已支持对待，位次由设置里的播放器优先级决定；未列出的自动补到末尾。
    const priority = playerOrder(priorityInput, auto.saved);
    const saved = [...new Set((auto.saved ?? []).filter(id => isAutoPlayer(id) && !priority.includes(id)))];
    const rank = new Map([...priority, ...saved].map((id, index) => [id, index]));
    // 未知播放器统一排在所有已知项之后；名次兜底成最大值，不会取到 undefined。
    const rankOf = (player: string): number => rank.get(player) ?? Number.MAX_SAFE_INTEGER;

    const known = sessions.filter(item => rank.has(item.player) && item.title);
    // 有官方/已保存的播放器在播时，未保存的未知播放器不接管；
    // 没有已知项时，只有未知会话本身也允许以暂停态作为兜底候选。
    const autoOn = auto.enabled && !known.some(item => item.status === 'playing');
    const extra = autoOn
      ? sessions.filter(item => isAutoPlayer(item.player) && !rank.has(item.player) && item.title
        && !isBlacklistedApp(item.app, auto.blacklist)
        && (item.status === 'playing' || known.length === 0))
      : [];
    const extraIds = [...new Set(extra.map(item => item.player))];
    const playingIds = [...new Set(extra.filter(item => item.status === 'playing').map(item => item.player))];
    // 首次出现或从暂停恢复播放时刷新时间，按「最近一次开始播放」排序。
    // 同一毫秒内连续选择时也要保证新开始的那次严格更新，因此取现有时间戳的下一格。
    const stamp = Math.max(Date.now(), ...[...this.autoSeen.values()].map(value => value + 1));
    for (const id of playingIds) if (!this.autoPrev.has(id)) this.autoSeen.set(id, stamp);
    const autoIds = extraIds
      .sort((a, b) => (this.autoSeen.get(b) ?? 0) - (this.autoSeen.get(a) ?? 0) || a.localeCompare(b));
    this.autoPrev = new Set(playingIds);
    for (const [id, at] of [...this.autoSeen]) {
      if (!this.autoPrev.has(id) && stamp - at > AUTO_MEMORY_MS) this.autoSeen.delete(id);
    }

    const ordered = [...known, ...extra].sort((a, b) =>
      (rankOf(a.player) - rankOf(b.player))
      || ((this.autoSeen.get(b.player) ?? 0) - (this.autoSeen.get(a.player) ?? 0))
      || a.app.localeCompare(b.app));
    if (ordered.length) return this.pickSession(priority, saved, autoIds, rankOf, ordered);
    const orderedWindows = windows
      .filter(item => rank.has(item.player) && item.title)
      .sort((a, b) => (rank.get(a.player)! - rank.get(b.player)!) || a.app.localeCompare(b.app));
    if (orderedWindows.length) return this.pickWindow(orderedWindows);
    this.reset();
    return null;
  }

  private pickSession(
    priority: readonly string[],
    saved: readonly string[],
    autoIds: readonly string[],
    rankOf: (player: string) => number,
    ordered: readonly SessionCandidate[],
  ): Selection {
    // 官方与已保存项在前：未保存的未知播放器只在没有已知项在播时进入候选。
    const order = [...priority, ...saved, ...autoIds];
    let best: SessionCandidate | null = null;
    let reason: SelectionReason = 'priority-playing';
    for (const player of order) {
      const playing = ordered.filter(item => item.player === player && item.status === 'playing');
      if (playing.length) { best = this.preferSession(playing); reason = 'priority-playing'; break; }
    }
    if (!best) {
      for (const player of order) {
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

    const stickyRank = rankOf(sticky.player);
    const bestRank = rankOf(best.player);
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
