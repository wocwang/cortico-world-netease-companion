/** 一行歌词：秒为单位的时间戳，翻译按行合并。 */
export interface LyricsLine { at: number; text: string; tr?: string }

export interface LyricsReference {
  status: 'ok' | 'empty' | 'unavailable' | 'disabled';
  reason?: string;
  song?: { id: number; title: string; artists: string[]; album: string };
  url?: string;
  match?: 'metadata' | 'title-artist-version-unverified';
  source?: string;
  hasTranslation?: boolean;
  total?: number;
  lines?: LyricsLine[];
  fetchedAt?: string;
}

/** 送给模型的摘要：前若干行 + 当前唱到的那一行。 */
export interface LyricsBrief {
  status: string;
  reason?: string;
  match?: string;
  source?: string;
  hasTranslation?: boolean;
  total?: number;
  lines?: LyricsLine[];
  currentLine?: LyricsLine;
}

// LRC 时间标签，支持 [mm:ss.xx] 与 [mm:ss.xxx]，也支持一行多个标签。
const TIME_TAG = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
const INLINE_TAG = /\[(?:by|ti|ar|al|offset|re|ve|length|kana)\s*:[^\]]*\]/gi;
// 制作名单关键词：字段名里出现这些词就当作 credit 行丢弃（“和声编写”“录音工程”这类复合字段也能覆盖）。
const CREDIT_WORD = /作词|作曲|编曲|制作|监制|出品|发行|企划|策划|统筹|宣传|录音|混音|母带|后期|和声|和音|伴唱|配唱|合音|编写|工程|吉他|贝斯|鼓|打击乐|键盘|合成器|弦乐|小提琴|中提琴|大提琴|萨克斯|铜管|木管|人声|调音|助理|词曲|lyric|compos|arrang|produc|mix|master|record|guitar|bass|drum|percussion|keyboard|synth|string|violin|cello|sax|brass|woodwind|vocal|chorus|backing|op\b|sp\b/i;

/** 判断一行是不是制作名单（“作词 : 某甲”“和声编写 : 某乙”），歌词正文不该被当成 credit。 */
export function isCreditLine(text: string): boolean {
  const index = text.search(/[:：]/);
  if (index <= 0) return false;
  const key = text.slice(0, index).trim();
  if (!key || key.length > 14) return false;
  if (/[，。！？、；,.!?;]/.test(key)) return false;
  return CREDIT_WORD.test(key);
}

/** 把 LRC 文本解析成按时间排序的行；元数据行（作词/作曲/和声编写等）与空行丢弃。 */
export function parseLrc(raw: string): LyricsLine[] {
  const lines: LyricsLine[] = [];
  for (const row of (raw || '').split(/\r?\n/)) {
    const text = row.replace(INLINE_TAG, '').trim();
    if (!text) continue;
    const tags = [...text.matchAll(TIME_TAG)];
    if (!tags.length) continue;
    const body = text.replace(TIME_TAG, '').trim();
    if (!body || isCreditLine(body)) continue;
    for (const tag of tags) {
      const seconds = Number(tag[1]) * 60 + Number(tag[2].replace(':', '.'));
      if (!Number.isFinite(seconds)) continue;
      lines.push({ at: Math.round(seconds * 100) / 100, text: body.slice(0, 200) });
    }
  }
  return lines.sort((a, b) => a.at - b.at);
}

/** 把翻译 LRC 按时间戳并到原文行上；时间差 0.35 秒以内视为同一行。 */
export function mergeTranslation(lines: LyricsLine[], rawTranslation: string): LyricsLine[] {
  const translated = parseLrc(rawTranslation);
  if (!translated.length) return lines;
  const byTime = new Map<number, string>();
  for (const line of translated) if (!byTime.has(line.at)) byTime.set(line.at, line.text);
  const times = [...byTime.keys()].sort((a, b) => a - b);
  for (const line of lines) {
    const exact = byTime.get(line.at);
    if (exact) { line.tr = exact; continue; }
    let best = -1;
    let bestGap = 0.35;
    for (const time of times) {
      const gap = Math.abs(time - line.at);
      if (gap <= bestGap) { best = time; bestGap = gap; }
    }
    const near = best >= 0 ? byTime.get(best) : undefined;
    if (near) line.tr = near;
  }
  return lines;
}

/** 根据播放进度找当前行下标；没有进度或超出范围返回 -1。 */
export function currentIndex(lines: LyricsLine[], positionSeconds?: number): number {
  if (!lines.length || !Number.isFinite(positionSeconds)) return -1;
  const position = Number(positionSeconds);
  let index = -1;
  for (let i = 0; i < lines.length; ++i) {
    if (lines[i].at <= position + 0.3) index = i; else break;
  }
  return index;
}

/** 裁剪成事件摘要：前 maxLines 行 + 当前行，避免每首歌把整首歌词塞进上下文。 */
export function briefLyrics(result: LyricsReference | { status: 'disabled' } | null | undefined,
  maxLines: number, positionSeconds?: number): LyricsBrief {
  if (!result || result.status === 'disabled') return { status: 'disabled' };
  if (result.status !== 'ok') return { status: result.status, reason: result.reason };
  const all = result.lines ?? [];
  const brief: LyricsBrief = {
    status: 'ok',
    match: result.match,
    source: result.source,
    hasTranslation: !!result.hasTranslation,
    total: result.total,
    lines: all.slice(0, Math.max(1, Math.min(200, Math.floor(maxLines)))),
  };
  const index = currentIndex(all, positionSeconds);
  if (index >= 0) brief.currentLine = all[index];
  return brief;
}

/** 单行摘要文案，给学生面板用。 */
export function lyricsLabel(result: LyricsReference | { status: 'disabled' } | null | undefined): string {
  if (!result || result.status === 'disabled') return '已关闭';
  if (result.status === 'ok') return `已获取 ${result.total ?? result.lines?.length ?? 0} 行${result.hasTranslation ? '（含翻译）' : ''}`;
  return '暂不可用';
}
