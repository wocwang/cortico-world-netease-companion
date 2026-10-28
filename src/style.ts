import type { SongBackground } from './comments.ts';
import type { TagFeel } from './tags.ts';

export type SongStyle = 'energetic' | 'soft' | 'old' | 'odd' | 'neutral';
export type StyleSource = 'tag' | 'inferred';

/** 副歌动作建议：风格只用于选动作，不是确定曲风。 */
export interface ChorusStyle {
  id: SongStyle;
  label: string;
  estimated: boolean;
  source: StyleSource;
  actions: string[];
}

const LABELS: Record<SongStyle, string> = {
  energetic: '偏燃', soft: '偏柔', old: '年代感', odd: '偏怪', neutral: '中性',
};

const KEYWORDS: Record<Exclude<SongStyle, 'neutral'>, string[]> = {
  energetic: ['摇滚', 'rock', '金属', 'metal', '朋克', 'punk', '电子', 'electronic', 'edm', '舞曲', 'dance',
    '说唱', 'rap', 'hip-hop', '嘻哈', 'dj', 'disco', 'house', 'techno', '燃', '劲爆', '现场', 'live'],
  soft: ['抒情', 'ballad', '民谣', 'folk', '钢琴', 'piano', 'acoustic', '轻音乐', 'ambient', 'chill',
    '治愈', '慢歌', '情歌', '古典', 'classical', '纯音乐', 'instrumental'],
  old: ['老歌', '经典', '怀旧', '年代', '戏曲', 'opera', 'traditional', '复古', 'oldies', 'classic', 'retro',
    '80年代', '90年代'],
  odd: ['实验', 'experimental', 'avant', '前卫', '另类', 'alternative', 'indie', '艺术', '噪音', 'noise',
    'spoken word', '朗诵'],
};

const ACTION_PREFS: Record<SongStyle, string[]> = {
  energetic: ['跳舞', '小跳', '跳', '点头'],
  soft: ['点头', '坐下'],
  old: ['点头', '转圈'],
  odd: ['张望', '摇头'],
  neutral: ['点头', '坐下'],
};

/** 从歌曲百科的曲风/标签/BPM 粗分风格；没有数据时按中性处理。 */
export function styleOf(background: SongBackground | undefined, availableMotions: readonly string[]): ChorusStyle {
  const wiki = background?.status === 'ok' ? background.wiki : undefined;
  const text = [...(wiki?.genres ?? []), ...(wiki?.tags ?? [])].join(' ').toLowerCase();
  const scores: Record<Exclude<SongStyle, 'neutral'>, number> = { energetic: 0, soft: 0, old: 0, odd: 0 };
  for (const [id, words] of Object.entries(KEYWORDS) as Array<[Exclude<SongStyle, 'neutral'>, string[]]>)
    for (const word of words) if (text.includes(word)) scores[id] += 2;
  const bpm = wiki?.bpm;
  if (bpm !== undefined && bpm >= 130) scores.energetic += 2;
  else if (bpm !== undefined && bpm > 0 && bpm <= 80) scores.soft += 1;
  const best = (Object.keys(scores) as Array<Exclude<SongStyle, 'neutral'>>)
    .sort((a, b) => scores[b] - scores[a])[0];
  const id: SongStyle = scores[best] > 0 ? best : 'neutral';
  const available = new Set(availableMotions);
  return { id, label: LABELS[id], estimated: true, source: 'inferred', actions: ACTION_PREFS[id].filter(name => available.has(name)) };
}

const FEEL_TO_STYLE: Record<TagFeel, SongStyle> = {
  hard: 'energetic', soft: 'soft', old: 'old', odd: 'odd', plain: 'neutral',
};

/** 用之前标过的听感覆盖自动推断；genre 只作为提示词里的短标签。 */
export function styleFromTag(feel: TagFeel, genre: string | undefined, availableMotions: readonly string[]): ChorusStyle {
  const id = FEEL_TO_STYLE[feel];
  const cleanGenre = (genre ?? '').trim();
  const available = new Set(availableMotions);
  return {
    id, label: cleanGenre ? `${LABELS[id]}（${cleanGenre}）` : LABELS[id],
    estimated: false, source: 'tag', actions: ACTION_PREFS[id].filter(name => available.has(name)),
  };
}
