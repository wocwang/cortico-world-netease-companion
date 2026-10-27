import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 当前形象支持的动作/表情词表；只用于提示模型，不修改宿主。 */
export interface ActionVocab {
  figure: string;
  expressions: string[];
  motions: string[];
}

interface FigureEntry {
  id?: unknown;
  kind?: unknown;
  names?: { zh?: unknown };
}

interface FigureFile {
  vocab?: unknown;
}

const PET_WEB = 'resources/app/node_modules/cortico-world-desktop-pet/web';
const PREFERRED = 'whale';
/** 听歌时不适合使用的词：睡觉是永久睡下，打盹会显得走神。 */
const SKIP = new Set(['sleep', 'sleepy']);

function roots(): string[] {
  const out: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) out.push(value.trim());
  };
  push(process.env.COOPANION_ROOT);
  push(process.env.PORTABLE_EXECUTABLE_DIR);
  const resources = (process as { resourcesPath?: unknown }).resourcesPath;
  push(typeof resources === 'string' ? dirname(resources) : undefined);
  push(dirname(process.execPath));
  push(process.cwd());
  // 源码或 data/extensions 安装时，向上找宿主根目录。
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; ++i) {
    push(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return [...new Set(out)];
}

function webDirs(): string[] {
  const out: string[] = [];
  for (const root of roots()) {
    out.push(join(root, PET_WEB));
    out.push(join(root, 'resources', 'app', 'node_modules', 'cortico-world-desktop-pet', 'web'));
  }
  const resources = (process as { resourcesPath?: unknown }).resourcesPath;
  if (typeof resources === 'string')
    out.push(join(resources, 'app', 'node_modules', 'cortico-world-desktop-pet', 'web'));
  return [...new Set(out)];
}

/** 从宿主 config.json 读取当前形象；读不到时返回默认鲸鱼。 */
function activeFigure(root?: string): string {
  for (const candidate of root ? [root] : roots()) {
    const path = join(candidate, 'data', 'home', 'companion', 'config.json');
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
        worlds?: Record<string, { skin?: { figure?: unknown } }>;
      };
      const figure = parsed?.worlds?.['desktop-pet']?.skin?.figure;
      if (typeof figure === 'string' && figure.trim()) return figure.trim();
    } catch {
      // 坏配置不阻塞读取；继续尝试其他根目录。
    }
  }
  return PREFERRED;
}

function parseFigure(figure: string, raw: string): ActionVocab | null {
  let parsed: FigureFile;
  try {
    parsed = JSON.parse(raw) as FigureFile;
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.vocab)) return null;
  const expressions: string[] = [];
  const motions: string[] = [];
  for (const item of parsed.vocab as FigureEntry[]) {
    const id = typeof item?.id === 'string' ? item.id : '';
    if (!id || SKIP.has(id)) continue;
    const names = item?.names?.zh;
    const zh = Array.isArray(names) ? names.find(name => typeof name === 'string' && name.trim()) : '';
    if (typeof zh !== 'string' || !zh.trim()) continue;
    if (item.kind === 'expression') expressions.push(zh.trim());
    else if (item.kind === 'motion') motions.push(zh.trim());
  }
  if (!expressions.length && !motions.length) return null;
  return { figure, expressions: [...new Set(expressions)], motions: [...new Set(motions)] };
}

function readFigure(web: string, figure: string): ActionVocab | null {
  const path = join(web, figure, 'figure.json');
  if (!existsSync(path)) return null;
  try {
    return parseFigure(figure, readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 读取宿主当前形象的动作/表情词表。
 * 只读本机文件；读不到时返回 null，调用方应让模型只发言、不要猜动作。
 */
export function readActionVocab(root?: string): ActionVocab | null {
  const dirs = root ? [join(root, PET_WEB)] : webDirs();
  for (const web of dirs) {
    if (!existsSync(web)) continue;
    const preferred = activeFigure(root);
    const direct = readFigure(web, preferred);
    if (direct) return direct;
    try {
      for (const entry of readdirSync(web, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const found = readFigure(web, entry.name);
        if (found) return found;
      }
    } catch {
      // 目录读不到，继续下一个候选。
    }
  }
  return null;
}

/** 拼成提示词里的可用词清单；没有词表时明确要求只发言。 */
export function actionVocabText(vocab: ActionVocab | null): string {
  if (!vocab) return '（未读到当前形象的动作词表；不确定时只发言，不要写动作）';
  const parts: string[] = [];
  if (vocab.expressions.length) parts.push(`表情：${vocab.expressions.join('、')}`);
  if (vocab.motions.length) parts.push(`动作：${vocab.motions.join('、')}`);
  return `${parts.join('；')}。当前形象：${vocab.figure}。`;
}
