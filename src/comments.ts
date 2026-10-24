import type { Track } from './state.ts';
import { collectBackground, fetchBaiduSong, type BackgroundNote } from './sources.ts';
import { fetchSongWiki, type SongWiki } from './wiki.ts';
import { mergeTranslation, parseLrc, type LyricsReference } from './lyrics.ts';

export type { LyricsReference } from './lyrics.ts';

export interface Song { id: number; title: string; artists: string[]; album: string; aliases?: string[]; popularity?: number }
export interface SongBackground {
  status: 'ok' | 'unavailable';
  reason?: string;
  source?: string;
  title?: string;
  text?: string;
  facts?: Array<{ label: string; value: string }>;
  /** 网易云音乐百科：曲风、标签、BPM、获奖、乐评、相似歌曲与相关歌单。 */
  wiki?: SongWiki;
  url?: string;
  fetchedAt?: string;
}
export interface CommentReference {
  status: 'ok' | 'unavailable' | 'disabled';
  reason?: string;
  song?: Song;
  url?: string;
  match?: 'metadata' | 'title-artist-version-unverified';
  fetchedAt?: string;
  excerpts?: Array<{ text: string; kind: 'hot' | 'recent' | 'rising'; likes: number }>;
  /** 歌曲背景：百度百科创作背景 + 网易云音乐百科的结构化资料。 */
  songBackground?: SongBackground;
}
export interface ArtistProfile {
  status: 'ok' | 'unavailable';
  reason?: string;
  artist?: { id: number; name: string; aliases: string[]; bio: string; musicSize: number; albumSize: number };
  works?: Array<{ title: string; album: string }>;
  albums?: Array<{ name: string; year?: number; company?: string }>;
  /** 第三方公开页面摘录：百度百科概述、Discogs 社区档案。 */
  background?: Array<{ source: string; kind: 'encyclopedia' | 'community'; text: string; url?: string }>;
  url?: string;
  fetchedAt?: string;
}
export interface CommentProvider {
  get(track: Track, signal?: AbortSignal, maxExcerpts?: number, withSongBackground?: boolean): Promise<CommentReference>;
  getArtist(track: Track, signal?: AbortSignal): Promise<ArtistProfile>;
  /** 可选：取当前曲目歌词；不支持歌词的 provider 可以不实现。 */
  lyrics?(track: Track, signal?: AbortSignal, maxLines?: number): Promise<LyricsReference>;
}
const clean = (v: unknown, max = 240) => typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '';
const APP_SUFFIX = /\s*[-–—]\s*(?:网易云音乐|NetEase Cloud Music)\s*$/i;
const APP_PREFIX = /^\s*(?:网易云音乐|NetEase Cloud Music)\s*[-–—]\s*/i;
const BRACKETS = /[（(【\[][^）)】\]]*[）)】\]]/g;
const ARTIST_SEPARATOR = /\s+(?:\/|&|,|;)\s+|\s*[、；，]\s*|\s*(?:\bfeat\.?\b|\bft\.?\b)\s*/i;

// Conservative simplified/traditional folding for comparison only. Unknown characters pass through.
const TRADITIONAL: Record<string, string> = {
  '風': '风', '雲': '云', '霧': '雾', '電': '电', '愛': '爱', '妳': '你', '裡': '里', '裏': '里',
  '說': '说', '聽': '听', '夢': '梦', '時': '时', '間': '间', '後': '后', '歲': '岁', '記': '记',
  '憶': '忆', '願': '愿', '遠': '远', '還': '还', '這': '这', '麼': '么', '樣': '样', '無': '无',
  '與': '与', '給': '给', '對': '对', '開': '开', '關': '关', '過': '过', '發': '发', '現': '现',
  '實': '实', '樂': '乐', '聲': '声', '詞': '词', '誰': '谁', '緣': '缘', '別': '别', '離': '离',
  '傷': '伤', '淚': '泪', '國': '国', '鄉': '乡', '親': '亲', '們': '们', '會': '会', '見': '见',
  '問': '问', '來': '来', '從': '从', '長': '长', '壞': '坏', '舊': '旧', '東': '东', '紅': '红',
  '綠': '绿', '藍': '蓝', '黃': '黄', '銀': '银', '鐵': '铁', '樓': '楼', '門': '门', '燈': '灯',
  '車': '车', '飛': '飞', '鳥': '鸟', '魚': '鱼', '貓': '猫', '樹': '树', '葉': '叶', '種': '种',
  '獄': '狱', '虛': '虚', '滿': '满', '圓': '圆', '彎': '弯', '線': '线', '點': '点', '邊': '边',
  '際': '际', '極': '极', '恆': '恒', '萬': '万', '億': '亿', '個': '个', '隻': '只', '雙': '双',
  '為': '为', '嗎': '吗', '臺': '台', '灣': '湾', '傑': '杰', '倫': '伦', '鄧': '邓', '陳': '陈',
  '張': '张', '劉': '刘', '羅': '罗', '楊': '杨', '趙': '赵', '吳': '吴', '鄭': '郑', '謝': '谢',
  '許': '许', '孫': '孙', '馬': '马', '蘇': '苏', '呂': '吕', '蔣': '蒋', '鐘': '钟', '盧': '卢',
  '陸': '陆', '譚': '谭', '韋': '韦', '賈': '贾', '鄒': '邹', '閻': '阎', '龍': '龙', '錢': '钱',
  '湯': '汤', '喬': '乔', '賀': '贺', '賴': '赖', '龔': '龚', '蕭': '萧', '馮': '冯', '韓': '韩',
  '範': '范', '嶽': '岳', '龐': '庞', '顏': '颜', '歐': '欧', '陽': '阳', '陰': '阴', '豐': '丰',
  '鋒': '锋', '劍': '剑', '橋': '桥', '莊': '庄', '園': '园', '廠': '厂', '廣': '广', '應': '应',
  '氣': '气', '態': '态', '醫': '医', '學': '学', '覺': '觉', '觀': '观', '歡': '欢', '難': '难',
  '隨': '随', '雖': '虽', '變': '变', '讓': '让', '認': '认', '識': '识', '讀': '读', '寫': '写',
  '畫': '画', '筆': '笔', '書': '书', '靈': '灵', '麗': '丽', '豔': '艳', '艷': '艳', '韻': '韵',
  '詩': '诗', '語': '语', '談': '谈', '話': '话', '請': '请', '該': '该', '證': '证', '驚': '惊',
  '嘆': '叹', '歎': '叹', '憂': '忧', '鬱': '郁', '瘋': '疯', '癡': '痴', '煙': '烟', '塵': '尘',
  '債': '债', '戀': '恋', '臉': '脸', '髮': '发', '絲': '丝', '響': '响', '靜': '静', '鬧': '闹',
  '熱': '热', '涼': '凉', '灘': '滩', '島': '岛', '蟲': '虫', '豬': '猪', '雞': '鸡', '鳳': '凤',
  '鷹': '鹰', '獅': '狮', '龜': '龟', '貝': '贝', '殼': '壳', '機': '机', '場': '场', '牆': '墙',
  '鎮': '镇', '縣': '县', '區': '区', '寬': '宽', '淺': '浅', '輕': '轻', '紀': '纪', '鏡': '镜',
  '鬥': '斗', '鬆': '松', '鬍': '胡', '週': '周', '準': '准', '製': '制', '偽': '伪', '嚇': '吓',
  '寶': '宝', '貴': '贵', '賤': '贱', '貧': '贫', '財': '财', '囉': '啰', '爾': '尔', '於': '于',
  '當': '当', '將': '将', '稱': '称',
};
const toSimplified = (s: string) => Array.from(s, c => TRADITIONAL[c] ?? c).join('');

const TITLE_PUNCT = /[\s\u0000-\u001f《》〈〉「」『』【】()（）[\]{}“”‘’"'·•,，.。!！?？:：;；、~～\-–—_/\\|]+/g;
// Keep dots in artist names: "周杰伦." is not "周杰伦".
const ARTIST_PUNCT = /[\s\u0000-\u001f《》〈〉「」『』【】()（）[\]{}“”‘’"'·,，。!！?？:：;；、~～\-–—_/\\|&]+/g;
const titleKey = (s: string) => toSimplified(s.normalize('NFKC')).replace(TITLE_PUNCT, '').toLowerCase();
const artistKey = (s: string) => toSimplified(s.normalize('NFKC')).replace(ARTIST_PUNCT, '').toLowerCase();
const searchText = (s: string) => s.normalize('NFKC').replace(/[《》〈〉「」『』【】()（）[\]{}“”‘’"']/g, ' ').replace(/\s+/g, ' ').trim();
const stripBracketed = (s: string) => s.replace(BRACKETS, ' ').replace(/\s+/g, ' ').trim();
const VERSION_WORD = /live|现场|演唱会|unplugged|acoustic|伴奏|instrumental|纯音乐|karaoke|ktv|cover|翻唱|remix|dj|片段|剪辑|铃声|试听|demo|重制|remaster/i;
const VERSION_WORD_G = /live|现场|演唱会|unplugged|acoustic|伴奏|instrumental|纯音乐|karaoke|ktv|cover|翻唱|remix|dj|片段|剪辑|铃声|试听|demo|重制|remaster/gi;
const COVER_WORD = /cover|翻唱|伴奏|instrumental|纯音乐|karaoke|ktv|dj|remix|片段|剪辑|铃声|试听/i;

export const trackKey = (t: Track) => JSON.stringify([t.title, t.artist, t.album]);

function splitArtists(name: string): string[] {
  return name.split(ARTIST_SEPARATOR).map(v => v.trim()).filter(Boolean);
}

/** Normalized artist names and aliases, including "艺名(别名)" and multi-artist separators. */
export function artistKeys(name: string): string[] {
  const out = new Set<string>();
  const add = (value: string) => { const key = artistKey(value); if (key) out.add(key); };
  // Add the full name before splitting so AC/DC and Simon & Garfunkel keep their identity.
  add(name);
  for (const part of splitArtists(name)) {
    add(part);
    const base = stripBracketed(part);
    if (base && base !== part) add(base);
    for (const bracket of part.match(BRACKETS) ?? []) {
      for (const alias of splitArtists(bracket.slice(1, -1))) add(alias);
    }
  }
  return [...out];
}

function splitTitle(raw: string): string[] {
  const spaced = raw.split(/\s+[-–—]\s+/).map(v => v.trim()).filter(Boolean);
  if (spaced.length >= 2) return spaced;
  // "起风了-买辣椒也用券": only split when both sides are Chinese, so Love-Story stays intact.
  const cjk = raw.split(/(?<=[\u4e00-\u9fff])\s*[-–—]\s*(?=[\u4e00-\u9fff])/).map(v => v.trim()).filter(Boolean);
  return cjk.length >= 2 ? cjk : [raw];
}

/** Interpret a raw window title as title/artist in both plausible orders. */
export function trackLabels(track: Track): Array<{ title: string; artist: string }> {
  const raw = (track.title.replace(APP_PREFIX, '').replace(APP_SUFFIX, '').trim()) || track.title;
  if (track.artist) return [{ title: raw, artist: track.artist }];
  const parts = splitTitle(raw);
  if (parts.length < 2) return [{ title: raw, artist: '' }];
  const labels = [{ title: parts[0], artist: parts[1] }, { title: parts[1], artist: parts[0] }];
  if (parts.length > 2) {
    labels.push({ title: parts[0], artist: parts.slice(1).join(' - ') });
    labels.push({ title: parts.slice(0, -1).join(' - '), artist: parts[parts.length - 1] });
  }
  return labels;
}

interface TitleInfo { base: string; version: string }
function titleInfo(title: string): TitleInfo {
  const brackets = (title.match(BRACKETS) ?? []).map(v => v.slice(1, -1).trim()).filter(Boolean);
  let base = stripBracketed(title);
  let suffix = '';
  const trailing = base.match(/\s+[-–—]\s+(.+)$/);
  if (trailing && VERSION_WORD.test(trailing[1])) {
    suffix = trailing[1].trim();
    base = base.slice(0, trailing.index).trim();
  }
  const tail = base.match(/\s+(live|现场|演唱会|unplugged|acoustic|伴奏|instrumental|纯音乐|karaoke|ktv|cover|翻唱|remix|dj|片段|剪辑|铃声|试听|demo|重制|remaster)\s*版?$/i);
  if (tail) {
    suffix = [suffix, tail[1]].filter(Boolean).join(' ');
    base = base.slice(0, tail.index).trim();
  }
  const version = ([...brackets, suffix].join(' ').match(VERSION_WORD_G) ?? []).map(v => v.toLowerCase()).sort().join('+');
  return { base: base || title, version };
}

function toSong(s: any): Song | null {
  const artists = (Array.isArray(s?.artists ?? s?.ar) ? (s.artists ?? s.ar) : [])
    .map((a: any) => clean(a?.name)).filter(Boolean);
  const aliases = (Array.isArray(s?.alia) ? s.alia : Array.isArray(s?.alias) ? s.alias : [])
    .map((a: any) => clean(typeof a === 'string' ? a : a?.name)).filter(Boolean);
  return Number.isSafeInteger(s?.id) && s.id > 0 && clean(s.name)
    ? { id: s.id, title: clean(s.name), artists, album: clean((s.album ?? s.al)?.name), aliases,
        ...(Number.isFinite(s.popularity) ? { popularity: Math.max(0, Math.min(100, s.popularity)) } : {}) } : null;
}
export function parseSongs(raw: any, max = 50): Song[] {
  const list = Array.isArray(raw?.result?.songs) ? raw.result.songs : Array.isArray(raw?.songs) ? raw.songs : null;
  if (!list) throw new Error('搜索接口返回格式不可用');
  return list.slice(0, max).flatMap((s: any) => toSong(s) ?? []);
}

export interface ArtistHit { id: number; name: string; aliases: string[]; musicSize: number; albumSize: number }
export function parseArtists(raw: any): ArtistHit[] {
  const list = Array.isArray(raw?.result?.artists) ? raw.result.artists : [];
  return list.flatMap((a: any) => {
    const name = clean(a?.name);
    const aliases = (Array.isArray(a?.alias) ? a.alias : []).map((v: any) => clean(v)).filter(Boolean);
    return Number.isSafeInteger(a?.id) && a.id > 0 && name
      ? [{ id: a.id, name, aliases, musicSize: Number.isFinite(a?.musicSize) ? a.musicSize : 0,
        albumSize: Number.isFinite(a?.albumSize) ? a.albumSize : 0 }] : [];
  });
}
export function parseArtistDetail(raw: any): NonNullable<ArtistProfile['artist']> | null {
  const a = raw?.artist;
  if (!Number.isSafeInteger(a?.id) || a.id <= 0 || !clean(a.name)) return null;
  return {
    id: a.id, name: clean(a.name),
    aliases: (Array.isArray(a.alias) ? a.alias : []).map((v: any) => clean(v)).filter(Boolean),
    bio: clean(a.briefDesc, 800),
    musicSize: Number.isFinite(a.musicSize) ? Math.max(0, a.musicSize) : 0,
    albumSize: Number.isFinite(a.albumSize) ? Math.max(0, a.albumSize) : 0,
  };
}
/** Representative songs from an artist detail payload, excluding versions and duplicates. */
export function parseArtistWorks(raw: any, artistName: string, max = 8): Array<{ title: string; album: string }> {
  const list = Array.isArray(raw?.hotSongs) ? raw.hotSongs : [];
  const keys = artistKeys(artistName);
  const seen = new Set<string>();
  const out: Array<{ title: string; album: string }> = [];
  for (const entry of list) {
    const song = toSong(entry);
    if (!song || VERSION_WORD.test(song.title)) continue;
    if (keys.length && !song.artists.some(name => artistKeys(name).some(key => keys.includes(key)))) continue;
    const key = titleKey(song.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ title: song.title, album: song.album });
    if (out.length >= max) break;
  }
  return out;
}
/** 合辑/精选等非原专辑标记：同曲多版本时优先原专辑，缺原专辑也不丢弃该曲。 */
const COMPILATION = /精选|合集|合辑|全记录|总冠军|排行榜|热门|情歌|冠军|珍藏|怀旧|歌单|金曲/i;
/** Prefer songs led by the artist, ordered by NetEase popularity, with the original album over compilations. */
export function selectArtistWorks(songs: Song[], artistName: string, max = 8): Array<{ title: string; album: string }> {
  const keys = artistKeys(artistName);
  const picked = new Map<string, Song>();
  for (const song of songs) {
    if (VERSION_WORD.test(song.title)) continue;
    const lead = song.artists[0];
    if (keys.length && !(lead && keys.some(key => artistKeys(lead).includes(key)))) continue;
    const key = titleKey(song.title);
    if (!key) continue;
    const current = picked.get(key);
    if (!current) { picked.set(key, song); continue; }
    const better = COMPILATION.test(current.album) && !COMPILATION.test(song.album);
    const worse = !COMPILATION.test(current.album) && COMPILATION.test(song.album);
    if (better || (!worse && (song.popularity ?? -1) > (current.popularity ?? -1))) picked.set(key, song);
  }
  return [...picked.values()]
    .sort((a, b) => (b.popularity ?? -1) - (a.popularity ?? -1))
    .slice(0, max)
    .map(song => ({ title: song.title, album: song.album }));
}
export function parseArtistAlbums(raw: any, max = 8): Array<{ name: string; year?: number; company?: string }> {
  const list = Array.isArray(raw?.hotAlbums) ? raw.hotAlbums : [];
  const out: Array<{ name: string; year?: number; company?: string }> = [];
  for (const entry of list) {
    const name = clean(entry?.name);
    if (!name) continue;
    const time = Number(entry?.publishTime);
    const year = Number.isFinite(time) && time > 0 && time < 4102444800000 ? new Date(time).getFullYear() : undefined;
    const company = clean(entry?.company, 80);
    out.push({ name, ...(year ? { year } : {}), ...(company ? { company } : {}) });
    if (out.length >= max) break;
  }
  return out;
}

function compatibleContainment(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (!short || short === long || !long.includes(short)) return false;
  const min = /[\u4e00-\u9fff]/.test(short) ? 3 : 5;
  if (short.length < min) return false;
  // G.E.M.邓紫棋 may extend 邓紫棋, but 周杰伦. must not become 周杰伦.
  const extra = long.replace(short, '');
  return /^[a-z0-9.\s]*$/i.test(extra) && /[a-z]/i.test(extra);
}

function artistTierFor(label: string, song: Song): number {
  const labelKeys = artistKeys(label);
  const songKeys = song.artists.flatMap(artistKeys);
  if (!labelKeys.length || !songKeys.length) return 0;
  if (labelKeys.some(k => songKeys.includes(k))) return 3;
  return labelKeys.some(k => songKeys.some(sk => compatibleContainment(k, sk))) ? 2 : 0;
}

/** 第三方来源标题/别名必须与当前歌手匹配，避免百科同名词条串到别人身上。 */
function backgroundMatches(names: string[], note: BackgroundNote): boolean {
  const labelKeys = names.flatMap(artistKeys);
  const noteKeys = [note.title, ...(note.names ?? [])].flatMap(artistKeys);
  return labelKeys.some(key => noteKeys.includes(key) || noteKeys.some(noteKey => compatibleContainment(key, noteKey)));
}

/** 歌曲词条必须歌名一致、正文提到当前歌手，并且确实是歌曲而不是同名条目。 */
function songBackgroundMatches(song: Song, note: BackgroundNote): boolean {
  const noteKey = titleKey(note.title);
  const baseKey = titleKey(titleInfo(song.title).base);
  if (!noteKey || (noteKey !== titleKey(song.title) && noteKey !== baseKey)) return false;
  const hay = [note.title, note.summary ?? '', note.text, ...(note.facts ?? []).map(f => `${f.label} ${f.value}`)].join(' ');
  const hayKey = artistKey(hay);
  if (song.artists.length && !song.artists.some(artist => artistKeys(artist).some(key => hayKey.includes(key)))) return false;
  return /歌曲|单曲|演唱|主题曲|片尾曲|插曲|配乐|原声/.test(`${note.summary ?? ''} ${note.text}`)
    || (note.facts ?? []).some(f => ['所属专辑', '谱曲', '填词', '作词', '作曲', '音乐风格', '发行日期', '歌曲原唱', '编曲'].includes(f.label));
}

export interface RankedSong {
  song: Song;
  score: number;
  match: NonNullable<CommentReference['match']>;
  titleTier: number;
  artistTier: number;
  perfect: boolean;
}

export function rankSongs(track: Track, songs: Song[]): RankedSong[] {
  const labels = trackLabels(track);
  const byId = new Map<number, RankedSong>();
  const titleOnly = new Map<string, RankedSong[]>();
  for (const label of labels) {
    const info = titleInfo(label.title);
    const labelKey = titleKey(label.title);
    const labelBase = titleKey(info.base);
    if (!labelKey && !labelBase) continue;
    for (const song of songs) {
      const songInfo = titleInfo(song.title);
      const songKey = titleKey(song.title);
      const songBase = titleKey(songInfo.base);
      let titleTier = 0;
      if (labelKey && labelKey === songKey) titleTier = 5;
      else if (labelKey && (song.aliases ?? []).some(a => titleKey(a) === labelKey)) titleTier = 4;
      else if (labelBase && labelBase === songBase) titleTier = 3;
      if (!titleTier) continue;
      const versionConflict = info.version !== songInfo.version;
      if (versionConflict && titleTier === 3) titleTier = 2;
      const artistTier = label.artist ? artistTierFor(label.artist, song) : 0;
      if (label.artist && artistTier === 0) continue;
      const albumExact = !!track.album && !!song.album && titleKey(track.album) === titleKey(song.album);
      const cover = COVER_WORD.test(song.title) && !COVER_WORD.test(label.title) && artistTier < 3;
      if (cover) continue;
      const versionBonus = versionConflict ? -1 : info.version && songInfo.version ? 1 : 0;
      const score = titleTier * 10 + artistTier * 4 + (albumExact ? 1 : 0) + versionBonus;
      if (label.artist) {
        if (titleTier < 2 || artistTier < 2) continue;
        const ranked: RankedSong = {
          song, score,
          match: albumExact && titleTier === 5 && artistTier === 3 ? 'metadata' : 'title-artist-version-unverified',
          titleTier, artistTier, perfect: titleTier === 5 && artistTier === 3,
        };
        const prev = byId.get(song.id);
        if (!prev || ranked.score > prev.score) byId.set(song.id, ranked);
      } else {
        if (titleTier < 5) continue;
        const ranked: RankedSong = { song, score, match: 'title-artist-version-unverified', titleTier, artistTier, perfect: false };
        const group = titleOnly.get(label.title) ?? [];
        group.push(ranked);
        titleOnly.set(label.title, group);
      }
    }
  }
  // A title alone must identify one artist; otherwise a cover can win.
  for (const group of titleOnly.values()) {
    const signatures = new Set(group.map(c => c.song.artists.map(artistKey).sort().join('/') || 'unknown'));
    if (signatures.size !== 1) continue;
    for (const candidate of group) {
      const prev = byId.get(candidate.song.id);
      if (!prev || candidate.score > prev.score) byId.set(candidate.song.id, candidate);
    }
  }
  return [...byId.values()].sort((a, b) => b.score - a.score);
}

export function matchSong(track: Track, songs: Song[]): { song: Song; match: NonNullable<CommentReference['match']> } | null {
  const best = rankSongs(track, songs)[0];
  return best ? { song: best.song, match: best.match } : null;
}

/** 求赞、打卡、抢楼等没有信息量的评论：直接丢弃。 */
const LOW_INFO = /(?:求|跪求|拜托|帮我|给).{0,5}(?:赞|顶|粉)|(?:点|刷|互).{0,2}(?:赞|顶)|赞我|顶我|互赞|互粉|送我上去|沙发|板凳|前排|打卡|签到|路过|水经验|经验\s*\+?\s*1|首评|抢前排/i;
/** 只有一句泛泛夸奖、没有具体内容的评论。 */
const EMPTY_PRAISE = /^(?:真好听|太好听|好好听|好听|好听哭了|神曲|经典|绝了|牛|牛逼|666|yyds|泪目|破防|开口跪|单曲循环|循环中|耳朵怀孕|爱了爱了|永远的神|天花板|神仙)[\s!！。.~～…]*$/i;
const NOISE = /^(?:哈哈哈+|嘿嘿+|呵呵+|啊啊+|呜呜+|爱了|冒泡|水一下|第一次|第一|沙发|板凳|前排|\d+)[\s!！。.~～…]*$/i;
const REPEAT = /(.)\1{4,}/;
const meaningful = (text: string) => text.replace(/[\s\p{P}\p{S}]/gu, '').length;

/** 信息量打分：叙事、乐评、背景、年份与转折加分，短泛评减分。 */
export function informationScore(text: string): number {
  const length = [...text].length;
  let score = Math.min(5, length / 12);
  if (/我|记得|那年|当时|第一次|后来|高中|大学|朋友|父亲|母亲|奶奶|爷爷|分手|结婚|婚礼|毕业|离开|回来/.test(text)) score += 3;
  if (/编曲|和弦|副歌|主歌|旋律|节奏|唱功|音色|转音|混音|歌词|作词|作曲|bridge|beat/i.test(text)) score += 2.5;
  if (/专辑|发行|电影|电视剧|动画|翻唱|原唱|背景|故事|MV|现场/i.test(text)) score += 2;
  if (/\d{4}\s*年|\d{2,}/.test(text)) score += 1.5;
  if (/但是|不过|其实|因为|所以|反而|感觉|像是|让我想起|好像/.test(text)) score += 1.5;
  if (length < 12) score -= 1.5;
  return score;
}

function droppable(text: string): boolean {
  const core = meaningful(text);
  if (core < 2) return true;
  if (LOW_INFO.test(text) || EMPTY_PRAISE.test(text) || NOISE.test(text)) return true;
  return REPEAT.test(text) && core <= 12;
}

export interface BackgroundTerm { text: string; weight: number }

const BACKGROUND_STRONG = /专辑|发行|作词|作曲|谱曲|编曲|原唱|制作人|获奖|奖项|影视|电影|电视剧/;
const BACKGROUND_WEAK = /风格|流派|时长/;
const termText = (value: string) => value.normalize('NFKC')
  .replace(/^[《「『【\[\(（]+|[》」』】\]\)）]+$/g, '').replace(/\s+/g, ' ').trim();
const termKey = (value: string) => termText(value).toLowerCase().replace(/\s+/g, '');

/** 从歌曲背景里挑出可用于匹配评论的专有信息；歌名与歌手本身不作为线索。 */
export function backgroundTerms(background: SongBackground | null | undefined, song?: { title: string; artists: string[] }): BackgroundTerm[] {
  if (!background || background.status !== 'ok') return [];
  const blocked = new Set([song?.title ?? '', ...(song?.artists ?? [])].map(termKey).filter(Boolean));
  const terms = new Map<string, BackgroundTerm>();
  const add = (value: unknown, weight: number) => {
    if (typeof value !== 'string') return;
    const text = termText(value);
    const key = termKey(text);
    if (key.length < 2 || blocked.has(key)) return;
    const current = terms.get(key);
    if (!current || current.weight < weight) terms.set(key, { text, weight });
  };
  const addLoose = (value: string, weight: number) => {
    add(value, weight);
    for (const quote of value.match(/《([^》]{1,40})》/g) ?? []) add(quote, weight);
    for (const year of value.match(/\b(?:19|20)\d{2}\b/g) ?? []) add(year, Math.max(3, weight - 1));
  };
  for (const fact of background.facts ?? []) {
    if (BACKGROUND_STRONG.test(fact.label)) addLoose(fact.value, 5);
    else if (BACKGROUND_WEAK.test(fact.label)) add(fact.value, 2);
  }
  // 百度词条概述里提到的专辑/作品名和年份也作为线索；歌名本身已在 blocked 中排除。
  for (const quote of background.text?.match(/《([^》]{1,40})》/g) ?? []) add(quote, 4);
  for (const year of background.text?.match(/\b(?:19|20)\d{2}\b/g) ?? []) add(year, 3);
  for (const genre of background.wiki?.genres ?? []) {
    for (const part of genre.split(/[-/、]/)) add(part, 2);
  }
  for (const tag of background.wiki?.tags ?? []) add(tag, 1.5);
  for (const award of background.wiki?.awards ?? []) {
    for (const part of award.split(/\s+/)) add(part, 4);
  }
  for (const appearance of background.wiki?.appearances ?? []) addLoose(appearance, 3);
  return [...terms.values()].sort((a, b) => b.weight - a.weight).slice(0, 24);
}

function backgroundRelevance(text: string, terms: BackgroundTerm[]): { bonus: number; strong: boolean } {
  if (!terms.length) return { bonus: 0, strong: false };
  const hay = termKey(text);
  let bonus = 0;
  let strong = false;
  for (const term of terms) {
    const key = termKey(term.text);
    if (!key || !hay.includes(key)) continue;
    if (term.weight > bonus) bonus = term.weight;
    if (term.weight >= 3) strong = true;
  }
  return { bonus: Math.min(6, bonus), strong };
}

interface CommentCandidate { text: string; kind: 'hot' | 'recent'; likes: number; order: number; score: number; rising: boolean; relevance: number; strongRelated: boolean }

export function parseComments(raw: any, maxExcerpts = 10, terms: BackgroundTerm[] = []): NonNullable<CommentReference['excerpts']> {
  if (!Array.isArray(raw?.comments) && !Array.isArray(raw?.hotComments) && !Array.isArray(raw?.topComments)) throw new Error('评论接口返回格式不可用');
  const total = Math.max(1, Math.min(50, Math.floor(Number.isFinite(maxExcerpts) ? maxExcerpts : 10)));
  const seen = new Set<string>();
  const candidates: CommentCandidate[] = [];
  const add = (values: any, kind: 'hot' | 'recent') => {
    for (const c of Array.isArray(values) ? values : []) {
      const text = clean(c?.content);
      if (!text || droppable(text) || seen.has(text)) continue;
      seen.add(text);
      candidates.push({ text, kind, likes: Number.isFinite(c.likedCount) ? Math.max(0, c.likedCount) : 0,
        order: candidates.length, score: 0, rising: false, relevance: 0, strongRelated: false });
    }
  };
  add([...(Array.isArray(raw.topComments) ? raw.topComments : []), ...(Array.isArray(raw.hotComments) ? raw.hotComments : [])], 'hot');
  add(raw.comments, 'recent');

  // 最新列表里点赞最高的几条：既新又有共鸣，单独标记并加权。
  const risingMax = Math.max(1, Math.ceil(total * 0.1));
  const rising = new Set(candidates.filter(c => c.kind === 'recent').sort((a, b) => b.likes - a.likes)
    .slice(0, risingMax).filter(c => c.likes >= 3));
  for (const c of candidates) {
    c.rising = rising.has(c);
    const background = backgroundRelevance(c.text, terms);
    c.relevance = background.bonus;
    c.strongRelated = background.strong;
    c.score = informationScore(c.text) + Math.min(6, Math.log2(1 + c.likes)) + (c.kind === 'hot' ? 1 : 0) +
      (c.rising ? 3 : 0) + c.relevance;
  }

  const picked: CommentCandidate[] = [];
  const take = (list: CommentCandidate[], max: number) => {
    let count = 0;
    for (const c of [...list].sort((a, b) => b.score - a.score || a.order - b.order)) {
      if (count >= max || picked.length >= total) break;
      if (picked.includes(c)) continue;
      picked.push(c);
      count++;
    }
  };
  const hotQuota = Math.ceil(total * 0.6);
  // 与歌曲背景事实（专辑、发行、词曲、获奖、影视等）有关的评论先占一席，避免被高赞泛评挤掉。
  take(candidates.filter(c => c.strongRelated), Math.max(1, Math.ceil(total * 0.3)));
  take([...rising], Math.max(1, risingMax));
  take(candidates.filter(c => c.kind === 'hot'), hotQuota);
  take(candidates.filter(c => c.kind === 'recent'), total);
  take(candidates.filter(c => c.kind === 'hot'), total);
  return picked.sort((a, b) => b.score - a.score || a.order - b.order)
    .map(c => ({ text: c.text, kind: c.rising ? 'rising' as const : c.kind, likes: c.likes }));
}

export class NeteaseComments implements CommentProvider {
  private cache = new Map<string, { until: number; result: CommentReference }>();
  private artists = new Map<string, { id: number | null; until: number }>();
  private profiles = new Map<string, { until: number; result: ArtistProfile }>();
  private songs = new Map<string, { until: number; result: SongBackground }>();
  private lyricCache = new Map<string, { until: number; result: LyricsReference }>();
  private blockedUntil = 0;
  constructor(private request: typeof fetch = fetch) {}
  private async json(path: string, signal?: AbortSignal): Promise<any> {
    const r = await this.request('https://music.163.com' + path, {
      headers: { Referer: 'https://music.163.com/', Accept: 'application/json' },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      if (r.status === 429 || r.status === 403 || r.status >= 500) this.blockedUntil = Date.now() + 60_000;
      await r.body?.cancel().catch(() => {});
      throw new Error(`网易云接口 HTTP ${r.status}`);
    }
    const reader = r.body?.getReader();
    if (!reader) throw new Error('网易云接口没有正文');
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 1_000_000) throw new Error('网易云接口正文过大');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (data.code !== 200) throw new Error(`网易云接口未成功（${String(data.code).slice(0, 20)}）`);
    return data;
  }
  private async findArtistId(name: string, signal?: AbortSignal): Promise<number | null> {
    const key = artistKey(name);
    const cached = this.artists.get(key);
    if (cached && cached.until > Date.now()) return cached.id;
    let id: number | null = null;
    const labelKeys = artistKeys(name);
    try {
      const search = new URLSearchParams({ s: searchText(name), type: '100', limit: '10', offset: '0' });
      const hits = parseArtists(await this.json('/api/search/get?' + search, signal));
      let best = 0;
      for (const hit of hits) {
        const hitKeys = [hit.name, ...hit.aliases].flatMap(artistKeys);
        const tier = labelKeys.some(k => hitKeys.includes(k)) ? 3
          : labelKeys.some(k => hitKeys.some(hk => compatibleContainment(k, hk))) ? 2 : 0;
        if (!tier) continue;
        // Real artists have a much larger catalog than same-name fan accounts.
        const score = tier * 50 + Math.min(Math.max(hit.musicSize, 0), 10000) * 10 + Math.min(Math.max(hit.albumSize, 0), 1000);
        if (score > best) { best = score; id = hit.id; }
      }
    } catch (e) {
      if (signal?.aborted) throw e;
    }
    this.artists.set(key, { id, until: Date.now() + (id ? 24 * 60 * 60_000 : 60_000) });
    while (this.artists.size > 40) this.artists.delete(this.artists.keys().next().value!);
    return id;
  }
  private async findArtistSongs(track: Track, artistId: number, signal?: AbortSignal): Promise<Song[]> {
    const songs: Song[] = [];
    const seen = new Set<number>();
    for (let offset = 0; offset < 300; offset += 100) {
      const raw = await this.json(`/api/v1/artist/songs?id=${artistId}&limit=100&offset=${offset}`, signal);
      const page = parseSongs(raw, 100);
      for (const song of page) if (!seen.has(song.id)) { seen.add(song.id); songs.push(song); }
      const ranked = rankSongs(track, songs);
      if (ranked.some(r => r.perfect || r.score >= 60)) return songs;
      if (page.length < 100) break;
    }
    return songs;
  }
  private async find(track: Track, signal?: AbortSignal): Promise<RankedSong[]> {
    const labels = trackLabels(track);
    const queries: string[] = [];
    const push = (query: string) => { const value = query.trim(); if (value && !queries.includes(value)) queries.push(value); };
    for (const label of labels.slice(0, 2)) {
      push([searchText(label.title), searchText(label.artist)].filter(Boolean).join(' '));
      push(searchText(label.title));
    }
    for (const label of labels) {
      push([searchText(titleInfo(label.title).base), searchText(label.artist)].filter(Boolean).join(' '));
    }
    const candidates = new Map<number, Song>();
    const add = (songs: Song[]) => { for (const song of songs) candidates.set(song.id, song); };
    const rank = () => rankSongs(track, [...candidates.values()]);
    let firstTotal = 0;
    let lastError: unknown = null;
    for (const [index, query] of queries.slice(0, 4).entries()) {
      if (Date.now() < this.blockedUntil) break;
      try {
        const search = new URLSearchParams({ s: query, type: '1', limit: '50', offset: '0' });
        const raw = await this.json('/api/search/get?' + search, signal);
        if (index === 0 && Number.isFinite(raw?.result?.songCount)) firstTotal = raw.result.songCount;
        add(parseSongs(raw, 50));
      } catch (e) {
        if (signal?.aborted) throw e;
        lastError = e;
        continue;
      }
      const ranked = rank();
      if (ranked.some(r => r.perfect)) return ranked;
    }
    let ranked = rank();
    // One extra page is enough to cover songs pushed out by covers and remixes.
    if (!ranked.length && firstTotal > 50 && Date.now() >= this.blockedUntil && queries[0]) {
      try {
        const search = new URLSearchParams({ s: queries[0], type: '1', limit: '50', offset: '50' });
        add(parseSongs(await this.json('/api/search/get?' + search, signal), 50));
        ranked = rank();
      } catch (e) {
        if (signal?.aborted) throw e;
        lastError = e;
      }
    }
    if (!ranked.length && Date.now() >= this.blockedUntil) {
      const artistName = labels.find(label => label.artist)?.artist;
      if (artistName) {
        try {
          const artistId = await this.findArtistId(artistName, signal);
          if (artistId) {
            add(await this.findArtistSongs(track, artistId, signal));
            ranked = rank();
          }
        } catch (e) {
          if (signal?.aborted) throw e;
          lastError = e;
        }
      }
    }
    if (ranked.length) return ranked;
    if (Date.now() < this.blockedUntil) throw new Error('评论服务正在冷却，暂时普通陪听');
    if (lastError instanceof Error) throw lastError;
    throw new Error('没有找到歌名、歌手或专辑信息相符的歌曲');
  }
  async getArtist(track: Track, signal?: AbortSignal): Promise<ArtistProfile> {
    signal?.throwIfAborted();
    const name = track.artist || trackLabels(track).find(label => label.artist)?.artist || '';
    if (!name) return { status: 'unavailable', reason: '没有可用的歌手信息' };
    if (Date.now() < this.blockedUntil) return { status: 'unavailable', reason: '网易云接口正在冷却，暂时普通陪听' };
    let result: ArtistProfile = { status: 'unavailable', reason: '歌手资料读取失败' };
    let cacheKey = '';
    try {
      const id = await this.findArtistId(name, signal);
      if (!id) return { status: 'unavailable', reason: '没有找到对应歌手' };
      cacheKey = String(id);
      const cached = this.profiles.get(cacheKey);
      if (cached && cached.until > Date.now()) return cached.result;
      const detail = await this.json(`/api/v1/artist/${id}`, signal);
      const artist = parseArtistDetail(detail);
      if (!artist) result = { status: 'unavailable', reason: '歌手资料格式不可用' };
      else {
        const labelNames = [...new Set([name, artist.name, ...artist.aliases])];
        const [albums, works, background] = await Promise.all([
          (async (): Promise<NonNullable<ArtistProfile['albums']>> => {
            try { return parseArtistAlbums(await this.json(`/api/artist/albums/${id}?limit=10&offset=0`, signal)); }
            catch (e) { if (signal?.aborted) throw e; return []; }
          })(),
          (async (): Promise<NonNullable<ArtistProfile['works']>> => {
            try { return selectArtistWorks(parseSongs(await this.json(`/api/v1/artist/songs?id=${id}&limit=100&offset=0`, signal), 100), artist.name); }
            catch (e) { if (signal?.aborted) throw e; return []; }
          })(),
          collectBackground(labelNames, signal, this.request).catch((e): BackgroundNote[] => { if (signal?.aborted) throw e; return []; }),
        ]);
        const notes = background.filter(note => backgroundMatches(labelNames, note))
          .map(({ source, kind, text, url }) => ({ source, kind, text, ...(url ? { url } : {}) }));
        result = { status: 'ok', artist, works: works.length ? works : parseArtistWorks(detail, artist.name),
          ...(albums.length ? { albums } : {}), ...(notes.length ? { background: notes } : {}),
          url: `https://music.163.com/artist?id=${id}`, fetchedAt: new Date().toISOString() };
      }
    } catch (e) {
      if (signal?.aborted) throw e;
      result = { status: 'unavailable', reason: e instanceof Error ? e.message : '歌手资料读取失败' };
    }
    if (cacheKey) {
      this.profiles.delete(cacheKey);
      this.profiles.set(cacheKey, { until: Date.now() + (result.status === 'ok' ? 24 * 60 * 60_000 : 5 * 60_000), result });
      while (this.profiles.size > 20) this.profiles.delete(this.profiles.keys().next().value!);
    }
    return result;
  }
  /** 条数较多时翻页取候选：接口单页最多 100 条，过滤后仍要尽量凑够目标条数。 */
  private async commentPages(songId: number, total: number, signal?: AbortSignal): Promise<any> {
    const size = total > 20 ? 100 : Math.max(5, total);
    const pages = total > 20 ? 2 : 1;
    let merged: any = null;
    const comments: any[] = [];
    for (let page = 0; page < pages; page++) {
      const data = await this.json(`/api/v1/resource/comments/R_SO_4_${songId}?limit=${size}&offset=${page * size}`, signal);
      merged ??= { ...data, comments: [] };
      if (Array.isArray(data.hotComments)) merged.hotComments = data.hotComments;
      if (Array.isArray(data.topComments)) merged.topComments = data.topComments;
      if (Array.isArray(data.comments)) comments.push(...data.comments);
      if (!data.more || !Array.isArray(data.comments) || data.comments.length < size) break;
    }
    return { ...merged, comments };
  }
  /** 百度百科创作背景 + 网易云音乐百科；两个来源独立，任一成功即返回。 */
  private async songBackground(song: Song, signal?: AbortSignal): Promise<SongBackground> {
    const key = String(song.id);
    const cached = this.songs.get(key);
    if (cached && cached.until > Date.now()) return cached.result;
    let result: SongBackground = { status: 'unavailable', reason: '歌曲背景读取失败' };
    try {
      const [baiduResult, wikiResult] = await Promise.allSettled([
        fetchBaiduSong(song.title, signal, this.request),
        fetchSongWiki(song.id, signal, this.request),
      ]);
      if (signal?.aborted) throw new Error('歌曲背景读取已取消');
      const note = baiduResult.status === 'fulfilled' ? baiduResult.value : null;
      const wiki = wikiResult.status === 'fulfilled' ? wikiResult.value : null;
      const baidu = note && songBackgroundMatches(song, note) ? note : null;
      if (baidu || wiki) {
        result = { status: 'ok',
          source: [baidu?.source, wiki ? '网易云音乐百科' : ''].filter(Boolean).join(' + '),
          title: baidu?.title ?? song.title,
          ...(baidu?.text ? { text: baidu.text } : {}),
          ...(baidu?.facts?.length ? { facts: baidu.facts } : {}),
          ...(wiki ? { wiki } : {}),
          ...(baidu?.url ? { url: baidu.url } : {}),
          fetchedAt: new Date().toISOString() };
      } else {
        const baiduReason = baiduResult.status === 'rejected' ? '百度百科暂时不可用'
          : note ? '词条与当前歌曲不匹配' : '没有找到歌曲词条';
        const wikiReason = wikiResult.status === 'rejected' ? '网易云百科暂时不可用' : '网易云百科暂无此曲条目';
        result = { status: 'unavailable', reason: `${baiduReason}；${wikiReason}` };
      }
    } catch (e) {
      if (signal?.aborted) throw e;
      result = { status: 'unavailable', reason: e instanceof Error ? e.message : '歌曲背景读取失败' };
    }
    this.songs.delete(key);
    this.songs.set(key, { until: Date.now() + (result.status === 'ok' ? 30 * 60_000 : 5 * 60_000), result });
    while (this.songs.size > 40) this.songs.delete(this.songs.keys().next().value!);
    return result;
  }
  /**
   * 取当前曲目的官方 LRC 歌词：复用 find() 的搜索匹配，翻译行按时间戳合并。
   * 成功结果按曲目缓存 60 分钟，同一首重听不重复请求；纯音乐或未提供歌词返回 empty。
   */
  async lyrics(track: Track, signal?: AbortSignal, maxLines = 80): Promise<LyricsReference> {
    const key = trackKey(track), cached = this.lyricCache.get(key);
    signal?.throwIfAborted();
    if (cached && cached.until > Date.now()) return cached.result;
    if (Date.now() < this.blockedUntil) return { status: 'unavailable', reason: '网易云接口正在冷却，暂时不读歌词' };
    let result: LyricsReference = { status: 'unavailable', reason: '歌词读取失败' };
    try {
      const found = await this.find(track, signal);
      const best = found[0];
      if (!best) {
        result = { status: 'empty', reason: '没有找到歌名、歌手或专辑信息相符的歌曲' };
      } else {
        const query = new URLSearchParams({ id: String(best.song.id), lv: '-1', tv: '-1', rv: '-1' });
        const raw = await this.json('/api/song/lyric?' + query, signal);
        const lines = parseLrc(typeof raw?.lrc?.lyric === 'string' ? raw.lrc.lyric : '');
        if (!lines.length) {
          result = { status: 'empty', reason: '这首歌没有可用的歌词（纯音乐或未提供）', song: best.song, match: best.match };
        } else {
          const translated = typeof raw?.tlyric?.lyric === 'string' ? raw.tlyric.lyric : '';
          const merged = translated ? mergeTranslation(lines, translated) : lines;
          result = { status: 'ok', song: best.song, match: best.match, source: 'netease-lrc',
            url: `https://music.163.com/song?id=${best.song.id}`, hasTranslation: merged.some(line => line.tr),
            total: merged.length, lines: merged.slice(0, Math.max(1, Math.min(200, Math.floor(maxLines)))),
            fetchedAt: new Date().toISOString() };
        }
      }
    } catch (e) {
      if (signal?.aborted) throw e;
      result = { status: 'unavailable', reason: e instanceof Error ? e.message : '歌词读取失败' };
    }
    this.lyricCache.delete(key);
    this.lyricCache.set(key, { until: Date.now() + (result.status === 'ok' ? 60 * 60_000 : 5 * 60_000), result });
    while (this.lyricCache.size > 20) this.lyricCache.delete(this.lyricCache.keys().next().value!);
    return result;
  }
  async get(track: Track, signal?: AbortSignal, maxExcerpts = 10, withSongBackground = false): Promise<CommentReference> {
    const total = Math.max(1, Math.min(50, Math.floor(Number.isFinite(maxExcerpts) ? maxExcerpts : 10)));
    const key = trackKey(track) + ':' + total + (withSongBackground ? ':bg' : ''), cached = this.cache.get(key);
    signal?.throwIfAborted();
    if (cached && cached.until > Date.now()) return cached.result;
    if (Date.now() < this.blockedUntil) return { status: 'unavailable', reason: '评论服务正在冷却，暂时普通陪听' };
    let result: CommentReference = { status: 'unavailable', reason: '评论读取失败' };
    try {
      const found = await this.find(track, signal);
      let last: RankedSong | null = null;
      for (const candidate of found.slice(0, 2)) {
        last = candidate;
        const [raw, songBackground] = await Promise.all([
          this.commentPages(candidate.song.id, total, signal),
          withSongBackground
            ? this.songBackground(candidate.song, signal).catch((e): SongBackground => {
              if (signal?.aborted) throw e;
              return { status: 'unavailable', reason: '歌曲背景暂时不可用' };
            })
            : Promise.resolve(null),
        ]);
        const excerpts = parseComments(raw, total, backgroundTerms(songBackground, candidate.song));
        if (excerpts.length) {
          result = { status: 'ok', song: candidate.song, url: `https://music.163.com/song?id=${candidate.song.id}`,
            match: candidate.match, fetchedAt: new Date().toISOString(), excerpts,
            ...(songBackground ? { songBackground } : {}) };
          break;
        }
      }
      if (result.status !== 'ok') {
        result = last
          ? { status: 'unavailable', reason: '评论区为空', song: last.song, url: `https://music.163.com/song?id=${last.song.id}`, match: last.match }
          : { status: 'unavailable', reason: '没有找到歌名、歌手或专辑信息相符的歌曲' };
      }
    } catch (e) {
      if (signal?.aborted) throw e;
      result = { status: 'unavailable', reason: e instanceof Error ? e.message : '评论读取失败' };
    }
    this.cache.delete(key);
    this.cache.set(key, { until: Date.now() + (result.status === 'ok' ? 30 * 60_000 : 5 * 60_000), result });
    while (this.cache.size > 40) this.cache.delete(this.cache.keys().next().value!);
    return result;
  }
}
