import { USER_AGENT } from './sources.ts';

export type PickSource = 'netease' | 'qq';

export interface PickTrack {
  source: PickSource;
  id: string;
  title: string;
  artist: string;
  album: string;
  durationSeconds: number;
  url: string;
}

export type PickResult =
  | { status: 'ok'; track: PickTrack }
  | { status: 'unavailable'; reason: string };

const TIMEOUT_MS = 6000;
const clean = (value: unknown, max = 120): string =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '';
const strArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(item => clean((item as { name?: unknown })?.name)).filter(Boolean) : [];

async function fetchJson(request: typeof fetch, url: string, headers: Record<string, string>): Promise<any> {
  const response = await request(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** 网易云公开搜索接口；失败时抛错，方便上层区分“没搜到”和“被限流”。 */
export async function searchNetease(query: string, request: typeof fetch = fetch): Promise<PickTrack[]> {
  const url = `https://music.163.com/api/search/get/web?s=${encodeURIComponent(query)}&type=1&offset=0&limit=8`;
  const data = await fetchJson(request, url, {
    accept: 'application/json',
    'user-agent': USER_AGENT,
    referer: 'https://music.163.com/',
    cookie: 'appver=2.0.2',
  });
  if (data?.code !== 200) throw new Error(`网易云搜索未成功（${data?.code ?? 'unknown'}）`);
  const songs = Array.isArray(data?.result?.songs) ? data.result.songs : [];
  return songs.map((song: any): PickTrack => {
    const id = String(song?.id ?? '');
    const title = clean(song?.name);
    return {
      source: 'netease', id, title,
      artist: strArray(song?.artists).join(' / '),
      album: clean(song?.album?.name),
      durationSeconds: Math.round(Number(song?.duration ?? 0) / 1000) || 0,
      url: id ? `https://music.163.com/song?id=${id}` : '',
    };
  }).filter((track: PickTrack) => track.title && track.url);
}

/** QQ 音乐公开搜索接口；返回歌曲详情页链接，不能自动点播。 */
export async function searchQQ(query: string, request: typeof fetch = fetch): Promise<PickTrack[]> {
  const url = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(query)}&format=json&n=8&p=1`;
  const data = await fetchJson(request, url, {
    accept: 'application/json',
    'user-agent': USER_AGENT,
    referer: 'https://y.qq.com/',
  });
  const songs = Array.isArray(data?.data?.song?.list) ? data.data.song.list : [];
  return songs.map((song: any): PickTrack => {
    const mid = clean(song?.songmid);
    const title = clean(song?.songname);
    return {
      source: 'qq', id: clean(song?.songid) || mid, title,
      artist: strArray(song?.singer).join(' / '),
      album: clean(song?.albumname),
      durationSeconds: Number(song?.interval ?? 0) || 0,
      url: mid ? `https://y.qq.com/n/ryqq/songDetail/${mid}` : `https://y.qq.com/n/ryqq/search?w=${encodeURIComponent(title)}`,
    };
  }).filter((track: PickTrack) => track.title && track.url);
}

/** 选一个最贴近查询的结果；同分时优先网易云，方便后续评论/歌词匹配。 */
export function pickBest(tracks: readonly PickTrack[], query: string): PickTrack | null {
  const usable = tracks.filter(track => track.durationSeconds === 0 || track.durationSeconds >= 30);
  if (!usable.length) return null;
  const wanted = query.normalize('NFKC').toLowerCase().replace(/[\s《》〈〉「」『』【】()（）]/g, '');
  let best: { track: PickTrack; score: number } | null = null;
  for (const track of usable) {
    const title = track.title.normalize('NFKC').toLowerCase().replace(/[\s《》〈〉「」『』【】()（）]/g, '');
    const artist = track.artist.normalize('NFKC').toLowerCase();
    let score = 0;
    if (title === wanted) score += 6;
    else if (title.startsWith(wanted) || wanted.startsWith(title)) score += 4;
    else if (title.includes(wanted) || wanted.includes(title)) score += 2;
    if (artist && wanted.includes(artist)) score += 2;
    if (track.source === 'netease') score += 1;
    if (!best || score > best.score) best = { track, score };
  }
  return best?.track ?? null;
}

export async function searchAndPick(query: string, request: typeof fetch = fetch): Promise<PickResult> {
  const [netease, qq] = await Promise.allSettled([searchNetease(query, request), searchQQ(query, request)]);
  const tracks = [
    ...(netease.status === 'fulfilled' ? netease.value : []),
    ...(qq.status === 'fulfilled' ? qq.value : []),
  ];
  const best = pickBest(tracks, query);
  if (best) return { status: 'ok', track: best };
  if (netease.status === 'rejected' && qq.status === 'rejected')
    return { status: 'unavailable', reason: '网易云和 QQ 音乐搜索都暂时不可用' };
  return { status: 'unavailable', reason: '没有搜到合适的曲目' };
}
