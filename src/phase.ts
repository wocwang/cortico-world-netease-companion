import type { Track } from './state.ts';

/** 按播放比例估的段落；不是波形分析，不能当成真实曲式。 */
export type SongSectionId = 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro';

export interface SongSection {
  id: SongSectionId;
  label: string;
  /** 始终为 true：位置由播放比例估算，不代表真实副歌/桥段位置。 */
  estimated: true;
}

/** 超过这个长度只给“前段/中段/后段”，不假装知道主歌副歌。 */
export const LONGFORM_SECONDS = 360;

const NORMAL: Record<SongSectionId, string> = {
  intro: '开场', verse: '主歌', chorus: '副歌', bridge: '桥段', outro: '尾声',
};

const LONGFORM: Record<SongSectionId, string> = {
  intro: '开头一段', verse: '前半段', chorus: '中段', bridge: '后半段', outro: '收尾段',
};

function idOf(ratio: number): SongSectionId {
  if (ratio < 0.15) return 'intro';
  if (ratio < 0.45) return 'verse';
  if (ratio < 0.72) return 'chorus';
  if (ratio < 0.88) return 'bridge';
  return 'outro';
}

/** 当前播放位置对应的段落；位置/时长不可用时返回 null。 */
export function sectionOf(track: Track | null | undefined): SongSection | null {
  const position = track?.positionSeconds;
  const duration = track?.durationSeconds;
  if (position === undefined || duration === undefined) return null;
  if (!Number.isFinite(position) || !Number.isFinite(duration) || position < 0 || duration < 30) return null;
  const ratio = Math.max(0, Math.min(1, position / duration));
  const id = idOf(ratio);
  return { id, label: (duration > LONGFORM_SECONDS ? LONGFORM : NORMAL)[id], estimated: true };
}
