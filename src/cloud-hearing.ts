/**
 * 外部听歌模型：把事件附带的音频切片发给一个 OpenAI 兼容的音频对话端点，
 * 换回一段文字分析。和主模型的原声输入相互独立，可以只开其中一个。
 */

export interface CloudHearingConfig {
  base: string;
  model: string;
  key: string;
}

export interface HearingAnswer {
  summary: string;
  instruments: string[];
  voices: string[];
  speech: string;
  tonic: string;
  tempo: string;
  model: string;
}

export type HearingResult = { ok: true; answer: HearingAnswer } | { ok: false; error: string };

const SYSTEM = [
  '你是一台听音分析器。你会收到一段十几秒的音乐切片（系统正在播放的声音）。',
  '只描述这段音频里确实听得到的东西。不要推测整首歌的曲式，不要编造歌词，不要评价好不好听。',
  '拿不准就写「不明确」，不要为了凑满字段而猜；speech 只有确实听清人声在唱/说的字才写。',
].join('');

function ask(seconds: number): string {
  return [
    `这是约 ${Math.round(seconds)} 秒的切片。只输出 JSON，不要解释、不要代码块：`,
    '{"summary":"一句中文，说这段最突出的是什么","instruments":["具体乐器，最多 3 个"],',
    ' "voices":["听得到的声部，从 人声/鼓/贝斯/吉他/钢琴/弦乐/合成器 里选"],',
    ' "speech":"听清的人声原话，听不清写空字符串","tonic":"调性，拿不准写 不明确",',
    ' "tempo":"慢/中/快/不明确"}',
  ].join('\n');
}

/** 云端请求体；单独导出便于测试固定形状。 */
export function buildHearingRequest(o: { base: string; model: string; wavBase64: string; seconds: number }):
{ url: string; body: Record<string, unknown> } {
  const base = (o.base || '').trim().replace(/\/+$/, '');
  const url = /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
  return {
    url,
    body: {
      model: o.model,
      // 带音频输入的对话模型普遍只支持流式（DashScope omni 直接要求 stream=true）。
      stream: true,
      stream_options: { include_usage: true },
      modalities: ['text'],
      temperature: 0.2,
      messages: [
        { role: 'system', content: [{ type: 'text', text: SYSTEM }] },
        {
          role: 'user',
          content: [
            { type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${o.wavBase64}`, format: 'wav' } },
            { type: 'text', text: ask(o.seconds) },
          ],
        },
      ],
    },
  };
}

/** 把流式增量拼成整段文本；兼容直接返回普通 JSON 的网关。 */
function collectText(raw: string): string {
  let text = '';
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: unknown } }> };
      const content = parsed.choices?.[0]?.delta?.content;
      text += textOf(content);
    } catch {
      // 心跳、注释或半行，跳过。
    }
  }
  return text;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content.map(item => (item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string'
      ? (item as { text: string }).text : '')).join('');
  return '';
}

function strings(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string')
    .map(item => item.trim().slice(0, 40)).filter(Boolean).slice(0, limit);
}

/** 从模型回答里提取 JSON；允许包在代码块或解释文字里。 */
export function parseHearingAnswer(raw: string, model: string): HearingAnswer | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const summary = typeof data.summary === 'string' ? data.summary.trim().slice(0, 160) : '';
    if (!summary) return null;
    return {
      summary,
      instruments: strings(data.instruments, 3),
      voices: strings(data.voices, 7),
      speech: typeof data.speech === 'string' ? data.speech.trim().slice(0, 120) : '',
      tonic: typeof data.tonic === 'string' ? data.tonic.trim().slice(0, 20) : '',
      tempo: typeof data.tempo === 'string' ? data.tempo.trim().slice(0, 8) : '',
      model,
    };
  } catch {
    return null;
  }
}

const TIMEOUT_MS = 20_000;

export async function analyzeClip(bytes: Uint8Array, seconds: number, cfg: CloudHearingConfig,
  signal?: AbortSignal): Promise<HearingResult> {
  const key = cfg.key.trim();
  if (!key) return { ok: false, error: '未配置外部听歌模型密钥' };
  if (!/^https?:\/\//i.test(cfg.base.trim())) return { ok: false, error: '外部听歌模型地址不是有效网址' };
  if (!cfg.model.trim()) return { ok: false, error: '未填写外部听歌模型名称' };
  if (signal?.aborted) return { ok: false, error: '已取消' };
  const { url, body } = buildHearingRequest({ base: cfg.base, model: cfg.model, seconds,
    wavBase64: Buffer.from(bytes).toString('base64') });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 120); } catch { /* 没有正文 */ }
      return { ok: false, error: `HTTP ${res.status}${detail ? `：${detail}` : ''}` };
    }
    let raw = '';
    if (res.body) {
      const decoder = new TextDecoder();
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>)
        raw += decoder.decode(chunk, { stream: true });
      raw += decoder.decode();
    } else {
      raw = await res.text();
    }
    const text = collectText(raw) || (() => {
      try {
        const parsed = JSON.parse(raw) as { choices?: Array<{ message?: { content?: unknown } }> };
        return textOf(parsed.choices?.[0]?.message?.content);
      } catch { return ''; }
    })();
    if (!text.trim()) return { ok: false, error: '模型返回了空内容' };
    const answer = parseHearingAnswer(text, cfg.model.trim());
    if (!answer) return { ok: false, error: '模型回答不是约定的 JSON' };
    return { ok: true, answer };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: /abort/i.test(message) ? '外部听歌模型超时' : message.slice(0, 120) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
