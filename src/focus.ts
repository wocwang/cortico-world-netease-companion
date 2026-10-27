import type { SongBackground } from './comments.ts';

export type FocusKey =
  | 'creation' | 'appearance' | 'album' | 'awards' | 'artist' | 'lyrics'
  | 'listeners' | 'memory' | 'profile' | 'mood' | 'scene' | 'variation';

/** 本次评论建议侧重的角度；World 只给建议，模型仍需按数据是否充分自行取舍。 */
export interface CommentFocus {
  key: FocusKey;
  label: string;
  instruction: string;
}

export interface FocusInput {
  /** <0 表示切歌开场，>=0 表示同曲分段序号。 */
  segmentIndex: number;
  background?: SongBackground;
  artistStatus?: string;
  lyrics?: { status: string; lines?: readonly unknown[] };
  excerptCount: number;
  memoryStatus?: string;
  preferenceCount: number;
  profileAvailable: boolean;
}

const LABELS: Record<FocusKey, string> = {
  creation: '创作背景', appearance: '影视/节目引用', album: '专辑/发行/词曲', awards: '获奖/平台乐评',
  artist: '歌手经历', lyrics: '歌词意象', listeners: '评论区听众视角', memory: '听歌记忆',
  profile: '用户明确口味', mood: '歌曲情绪/氛围', scene: '共同听歌的此刻', variation: '换一个说法',
};

const INSTRUCTIONS: Record<FocusKey, string> = {
  creation: '本次侧重创作背景：优先用 songBackground.text 里的创作动机、制作信息或创作故事，讲一个具体事实，再带一句你的感受；不要堆参数。',
  appearance: '本次侧重影视/节目引用：优先用 songBackground.wiki.appearances，说明它出现在哪部作品/节目；没有就换下一个角度。',
  album: '本次侧重专辑/发行/词曲：从 songBackground.facts 选一个具体字段（专辑、发行日期、作词作曲），不要堆参数。',
  awards: '本次侧重获奖或平台乐评：从 songBackground.wiki.awards 或 review 选一个，说明来源；没有就换下一个角度。',
  artist: '本次侧重歌手：用 artistContext 的简介、代表作或风格线索联系这首歌；不要编私生活或没写的奖项。',
  lyrics: '本次侧重歌词：从当前歌词窗口挑一句意象或情绪，用自己的话回应一两句；不要整段照搬，也不要把没出现在窗口里的词当事实。',
  listeners: '本次侧重评论区：选一条有信息量的听众视角，转述其感受或故事，不要逐条播报，也不要把网友说法当成作品事实。',
  memory: '本次侧重听歌记忆：只在 relation 或常听歌手自然时提一次，例如以前听过、又遇到这个歌手；不要翻完整历史，也不要把播放次数说成喜好排名。',
  profile: '本次侧重用户明确口味：用 commentPreferences/profileSummary 里明确说过的偏好调整题材、详略或语气；不要声称用户没说过的话，也不要把沉默当偏好。',
  mood: '本次侧重歌曲情绪/氛围：说此刻的感受、画面或身体反应；不要编造音频细节、编曲、鼓点或演唱。',
  scene: '本次侧重共同听歌的此刻：联系有依据的时间/场景/正在做的事，或轻轻邀请一起听；没有依据就不要硬猜。',
  variation: '本首前面的角度都用过了；这次换一个说法，讲一个前面没提过的细节或感受，短一点，不要重复已经说过的事实或句子。',
};

const OPENING: FocusKey[] = [
  'creation', 'appearance', 'artist', 'album', 'awards', 'lyrics', 'listeners', 'memory', 'profile', 'mood', 'scene',
];

const SEGMENTS: FocusKey[][] = [
  ['lyrics', 'mood', 'listeners', 'memory', 'profile', 'creation', 'appearance', 'artist', 'album', 'awards', 'scene'],
  ['memory', 'profile', 'scene', 'lyrics', 'mood', 'listeners', 'artist', 'creation', 'appearance', 'album', 'awards'],
  ['scene', 'mood', 'profile', 'memory', 'lyrics', 'listeners', 'artist', 'creation', 'appearance', 'album', 'awards'],
];

function available(key: FocusKey, input: FocusInput): boolean {
  const bg = input.background;
  switch (key) {
    case 'creation': return bg?.status === 'ok' && !!bg.text?.trim();
    case 'appearance': return (bg?.wiki?.appearances?.length ?? 0) > 0;
    case 'album': return bg?.status === 'ok' && (bg.facts?.length ?? 0) > 0;
    case 'awards': return (bg?.wiki?.awards?.length ?? 0) > 0 || !!bg?.wiki?.review?.text;
    case 'artist': return input.artistStatus === 'ok';
    case 'lyrics': return input.lyrics?.status === 'ok' && ((input.lyrics.lines?.length ?? 0) > 0);
    case 'listeners': return input.excerptCount > 0;
    case 'memory': return input.memoryStatus === 'ok';
    case 'profile': return input.preferenceCount > 0 || input.profileAvailable;
    case 'mood': case 'scene': return true;
    default: return false;
  }
}

/** 按开场/分段序号轮换侧重；跳过本首已经用过或数据不足的角度。 */
export function chooseFocus(input: FocusInput, used: ReadonlySet<FocusKey>): CommentFocus {
  const order = input.segmentIndex < 0
    ? OPENING
    : (SEGMENTS[Math.min(input.segmentIndex, SEGMENTS.length - 1)] ?? SEGMENTS[0]);
  for (const key of order) {
    if (!used.has(key) && available(key, input))
      return { key, label: LABELS[key], instruction: INSTRUCTIONS[key] };
  }
  for (const key of Object.keys(LABELS) as FocusKey[]) {
    if (key !== 'variation' && !used.has(key) && available(key, input))
      return { key, label: LABELS[key], instruction: INSTRUCTIONS[key] };
  }
  return { key: 'variation', label: LABELS.variation, instruction: INSTRUCTIONS.variation };
}
