/**
 * 歌手背景补充来源。只做匿名读取和短摘录，失败时静默降级。
 * 百度百科提供中文概述，Discogs 提供社区维护的英文艺人档案；两者都属于第三方公开页面。
 */
const UA = 'CorticoNeteaseCompanion/1.6.0 (+https://github.com/wocwang/cortico-world-netease-companion)';
const REQUEST_TIMEOUT = 5000;
/** 整组背景请求的预算：超时就只用已返回的部分，不拖慢评论机会。 */
const BUDGET = 5000;

export interface BackgroundNote {
  source: '百度百科' | 'Discogs';
  kind: 'encyclopedia' | 'community';
  /** 来源页上的标题或艺名，用于校验是否同一歌手。 */
  title: string;
  text: string;
  /** 词条的一句话说明（歌曲词条使用）。 */
  summary?: string;
  /** 词条信息框字段：所属专辑、词曲、发行日期等。 */
  facts?: Array<{ label: string; value: string }>;
  url?: string;
  /** Discogs 的别名/原名，参与同一性校验。 */
  names?: string[];
}

const clean = (v: unknown, max = 500) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const https = (v: unknown) => typeof v === 'string' && /^https?:\/\//i.test(v) ? v.replace(/^http:/i, 'https:') : undefined;
const discogsUrl = (uri: unknown) => {
  if (typeof uri !== 'string' || !uri) return undefined;
  return https(/^https?:\/\//i.test(uri) ? uri : `https://www.discogs.com${uri}`);
};

/** 查询词变体：完整名、去括号名、其中的中文段，兼顾 "G.E.M.邓紫棋" 与 "冯沁苑(买辣椒也用券)"。 */
function nameVariants(name: string): string[] {
  const out = [name, name.replace(/[（(【\[][^）)】\]]*[）)】\]]/g, ' ').trim(), ...(name.match(/[\u4e00-\u9fff]+/g) ?? [])];
  return [...new Set(out.map(v => v.trim()).filter(Boolean))].slice(0, 4);
}

async function getJson(url: string, signal: AbortSignal | undefined, request: typeof fetch): Promise<any> {
  const r = await request(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT)]) : AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  if (!r.ok) {
    await r.body?.cancel().catch(() => {});
    throw new Error(`背景来源 HTTP ${r.status}`);
  }
  const text = await r.text();
  if (text.length > 1_000_000) throw new Error('背景来源正文过大');
  return JSON.parse(text);
}

/** 百度百科词条概述；词条不存在或格式变化时返回 null。 */
export async function fetchBaiduBaike(name: string, signal?: AbortSignal, request: typeof fetch = fetch): Promise<BackgroundNote | null> {
  let lastError: unknown;
  for (const query of nameVariants(name)) {
    try {
      const params = new URLSearchParams({ scope: '103', format: 'json', appid: '379020', bk_key: query, bk_length: '600' });
      const data = await getJson('https://baike.baidu.com/api/openapi/BaikeLemmaCardApi?' + params, signal, request);
      const title = clean(data?.title, 80);
      const text = clean(data?.abstract ?? data?.desc);
      if (title && text) return { source: '百度百科', kind: 'encyclopedia', title, text, url: https(data?.url) };
    } catch (e) {
      if (signal?.aborted) throw e;
      lastError = e;
    }
  }
  if (lastError) throw lastError;
  return null;
}

/** 百度百科歌曲词条：创作背景概述 + 信息框中的词曲、专辑、发行与风格。 */
export async function fetchBaiduSong(title: string, signal?: AbortSignal, request: typeof fetch = fetch): Promise<BackgroundNote | null> {
  const params = new URLSearchParams({ scope: '103', format: 'json', appid: '379020', bk_key: title, bk_length: '600' });
  const data = await getJson('https://baike.baidu.com/api/openapi/BaikeLemmaCardApi?' + params, signal, request);
  const entry = clean(data?.title, 80);
  const text = clean(data?.abstract, 700);
  if (!entry || !text) return null;
  const facts = (Array.isArray(data?.card) ? data.card : [])
    .map((card: any) => ({
      label: clean(card?.name, 40),
      value: clean(String(Array.isArray(card?.value) ? card.value[0] ?? '' : card?.value ?? '').replace(/<[^>]*>/g, ''), 80),
    }))
    .filter((fact: { label: string; value: string }) => fact.label && fact.value)
    .slice(0, 12);
  return { source: '百度百科', kind: 'encyclopedia', title: entry, text, summary: clean(data?.desc, 120),
    ...(facts.length ? { facts } : {}), url: https(data?.url) };
}
/** Discogs 社区艺人档案；只对含拉丁字母的歌手名检索，降低同名误配。 */
export async function fetchDiscogs(name: string, signal?: AbortSignal, request: typeof fetch = fetch): Promise<BackgroundNote | null> {
  let lastError: unknown;
  for (const query of nameVariants(name).filter(v => /[a-z]/i.test(v)).slice(0, 2)) {
    try {
      const search = new URLSearchParams({ q: query, type: 'artist', per_page: '3' });
      const hits = await getJson('https://api.discogs.com/database/search?' + search, signal, request);
      const id = Number(Array.isArray(hits?.results) ? hits.results[0]?.id : NaN);
      if (!Number.isSafeInteger(id) || id <= 0) continue;
      const detail = await getJson(`https://api.discogs.com/artists/${id}`, signal, request);
      const text = clean(detail?.profile);
      const title = clean(detail?.name, 80);
      if (!title || !text) continue;
      const names = [detail.name, detail.realname, ...(Array.isArray(detail.namevariations) ? detail.namevariations : [])]
        .map((v: unknown) => clean(v, 80)).filter(Boolean);
      return { source: 'Discogs', kind: 'community', title, text, names, url: discogsUrl(detail?.uri) };
    } catch (e) {
      if (signal?.aborted) throw e;
      lastError = e;
    }
  }
  if (lastError) throw lastError;
  return null;
}

/** 并行读取背景来源；按候选名（歌手名、网易云艺名、别名）依次尝试，单源失败不影响另一源。 */
export async function collectBackground(names: string | string[], signal?: AbortSignal, request: typeof fetch = fetch): Promise<BackgroundNote[]> {
  const queries = [...new Set((Array.isArray(names) ? names : [names]).map(v => v.trim()).filter(Boolean))].slice(0, 3);
  if (!queries.length) return [];
  const timer = AbortSignal.timeout(BUDGET);
  const composite = signal ? AbortSignal.any([signal, timer]) : timer;
  const first = async (run: (query: string) => Promise<BackgroundNote | null>, list: string[]) => {
    for (const query of list) {
      try {
        const note = await run(query);
        if (note) return note;
      } catch (e) {
        if (signal?.aborted) throw e;
      }
    }
    return null;
  };
  const results = await Promise.allSettled([
    first(query => fetchBaiduBaike(query, composite, request), queries),
    first(query => fetchDiscogs(query, composite, request), queries.filter(query => /[a-z]/i.test(query))),
  ]);
  if (signal?.aborted) throw new Error('歌手背景读取已取消');
  return results.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []);
}
