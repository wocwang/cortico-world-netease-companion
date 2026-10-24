/**
 * 网易云「歌曲百科」读取。走客户端 eapi，匿名可用。
 * 只取结构化字段和一段平台乐评；失败时静默降级，不影响百度百科与评论区。
 */
import { createCipheriv, createHash } from 'node:crypto';

const API = 'https://interface.music.163.com';
const URI = '/api/song/play/about/block/page';
const EAPI_KEY = 'e82ckenh8dichen8';
const EAPI_NONCE = '36cd479b6b5';
const UA = 'NeteaseMusic/9.1.65.240927161425(9001065);Dalvik/2.1.0 (Linux; U; Android 14; 23013RK75C Build/UKQ1.230804.001)';
const REQUEST_TIMEOUT = 5000;

export interface SongWiki {
  genres: string[];
  tags: string[];
  language?: string;
  bpm?: number;
  awards: string[];
  appearances: string[];
  sheetCount?: number;
  review?: { author?: string; text: string };
  similar: Array<{ id?: number; title: string; artist?: string }>;
  playlists: Array<{ id?: number; title: string }>;
  url: string;
  fetchedAt: string;
}

const clean = (v: unknown, max = 240) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const list = (v: unknown): any[] => Array.isArray(v) ? v : [];
const titleOf = (ui: any) => clean(ui?.mainTitle?.title, 120);
const textValues = (ui: any) => list(ui?.textLinks).map(link => clean(link?.text, 80)).filter(Boolean);
const buttonValues = (ui: any) => list(ui?.buttons).map(button => clean(button?.text, 80)).filter(Boolean);
const resourceValues = (creative: any) => list(creative?.resources).map((resource: any) => titleOf(resource?.uiElement)).filter(Boolean);
const unique = (values: string[], max: number) => [...new Set(values)].slice(0, max);

function eapiParams(uri: string, data: unknown): string {
  const text = JSON.stringify(data);
  const digest = createHash('md5').update(`nobody${uri}use${text}md5forencrypt`).digest('hex');
  const plain = `${uri}-${EAPI_NONCE}-${text}-${EAPI_NONCE}-${digest}`;
  const cipher = createCipheriv('aes-128-ecb', Buffer.from(EAPI_KEY), Buffer.alloc(0));
  return cipher.update(plain, 'utf8', 'hex') + cipher.final('hex');
}

/** 从 eapi 原始响应里提取可读字段；没有任何内容时返回 null。 */
export function parseSongWiki(raw: any, songId: number, now = new Date()): SongWiki | null {
  const blocks = list(raw?.data?.blocks ?? raw?.blocks);
  const basic = blocks.find((block: any) => block?.code === 'SONG_PLAY_ABOUT_SONG_BASIC');
  const creatives = list(basic?.creatives);
  const creative = (type: string) => creatives.find((item: any) => item?.creativeType === type);

  const genres = unique(resourceValues(creative('songTag')), 4);
  const tags = unique(resourceValues(creative('songBizTag')), 8);
  const language = textValues(creative('language')?.uiElement)[0];
  const bpmValue = Number(textValues(creative('bpm')?.uiElement)[0]);
  const bpm = Number.isFinite(bpmValue) && bpmValue > 0 ? Math.round(bpmValue) : undefined;

  const awards = unique(list(creative('songAward')?.resources).map((resource: any) =>
    [titleOf(resource?.uiElement), ...list(resource?.uiElement?.subTitles).map((sub: any) => clean(sub?.title, 80))]
      .filter(Boolean).join(' ')).filter(Boolean), 4);
  const appearances = unique(list(creative('entertainment')?.resources)
    .map((resource: any) => titleOf(resource?.uiElement)).filter(Boolean), 4);
  const sheetValue = Number(/(\d+)/.exec(buttonValues(creative('sheet')?.uiElement)[0] ?? '')?.[1]);
  const sheetCount = Number.isSafeInteger(sheetValue) && sheetValue > 0 ? sheetValue : undefined;

  const reviewResource = list(creative('songComment')?.resources)
    .map((resource: any) => ({
      author: titleOf(resource?.uiElement).replace(/^乐评来自\s*/, '').trim() || undefined,
      text: clean(list(resource?.uiElement?.descriptions)[0]?.description, 300),
    }))
    .find((item: { text: string }) => item.text);
  const review = reviewResource ? { ...(reviewResource.author ? { author: reviewResource.author } : {}), text: reviewResource.text } : undefined;

  const similar = list(blocks.find((block: any) => block?.code === 'SONG_PLAY_ABOUT_SIMILAR_SONG')?.creatives)
    .flatMap((item: any) => list(item?.resources))
    .filter((resource: any) => String(resource?.resourceType).toUpperCase() === 'SONG')
    .map((resource: any) => {
      const id = Number(resource?.resourceId);
      return {
        ...(Number.isSafeInteger(id) && id > 0 ? { id } : {}),
        title: titleOf(resource?.uiElement),
        artist: clean(list(resource?.uiElement?.subTitles).map((sub: any) => sub?.title).join('/'), 120) || undefined,
      };
    })
    .filter((item: { title: string }) => item.title)
    .slice(0, 5);
  const playlists = list(blocks.find((block: any) => block?.code === 'SONG_PLAY_ABOUT_RELATED_PLAYLIST')?.creatives)
    .flatMap((item: any) => list(item?.resources))
    .filter((resource: any) => String(resource?.resourceType).toUpperCase() === 'PLAYLIST')
    .map((resource: any) => {
      const id = Number(resource?.resourceId);
      return { ...(Number.isSafeInteger(id) && id > 0 ? { id } : {}), title: titleOf(resource?.uiElement) };
    })
    .filter((item: { title: string }) => item.title)
    .slice(0, 5);

  if (!genres.length && !tags.length && !language && !bpm && !awards.length && !appearances.length &&
    !sheetCount && !review && !similar.length && !playlists.length) return null;
  return { genres, tags, ...(language ? { language } : {}), ...(bpm ? { bpm } : {}), awards, appearances,
    ...(sheetCount ? { sheetCount } : {}), ...(review ? { review } : {}), similar, playlists,
    url: `https://music.163.com/song?id=${songId}`, fetchedAt: now.toISOString() };
}

/** 读取当前网易云歌曲 ID 的百科；匿名可用，非 200 或没有内容时返回 null。 */
export async function fetchSongWiki(songId: number, signal?: AbortSignal, request: typeof fetch = fetch): Promise<SongWiki | null> {
  const now = Date.now();
  const header = {
    osver: 'Microsoft-Windows-10-Professional-build-19045-64bit', deviceId: '', os: 'pc',
    appver: '3.1.17.204416', versioncode: '140', mobilename: '', buildver: String(now).slice(0, 10),
    resolution: '1920x1080', __csrf: '', channel: 'netease', requestId: `${now}_${String(songId).slice(0, 4)}`,
  };
  const cookie = Object.keys(header)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(String(header[key as keyof typeof header]))}`)
    .join('; ');
  const params = eapiParams(URI, { songId, header, e_r: false });
  const r = await request(`${API}/eapi${URI.slice(4)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
      Cookie: cookie,
      Referer: 'https://music.163.com/',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ params }).toString(),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT)]) : AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  if (!r.ok) {
    await r.body?.cancel().catch(() => {});
    throw new Error(`网易云百科 HTTP ${r.status}`);
  }
  const text = await r.text();
  if (text.length > 1_000_000) throw new Error('网易云百科正文过大');
  const raw = JSON.parse(text);
  if (raw?.code !== 200) return null;
  return parseSongWiki(raw, songId);
}
