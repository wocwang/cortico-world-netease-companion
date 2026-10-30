/**
 * 记忆存在哪。
 *
 * 默认跟着宿主的 `dataDir`（每台机器一份）。但"听过什么"是跟着人走的，不跟着机器走：
 * 公司听一下午、回家还想接着聊，靠的就是把记忆放到一个两边都看得见的目录
 * （OneDrive、坚果云、NAS、移动硬盘都行）。
 *
 * 这里只做一件事：把「配置里写的目录」翻译成一个能用的绝对路径。
 *
 * - 写入只写当前目录。运行中换目录是热生效，下一次保存就落到新位置。
 * - 读取永远合并两处（当前目录 + 本机旧目录），切换目录那天旧记录不会凭空消失。
 *   没有"搬迁"这个动作，也就没有搬一半坏掉的窗口。
 * - 当前目录不可用时退回本机，并把原因原样记下来——最坏的情况是
 *   "看起来在同步盘里，其实一直写本机"，这一条不能静默。
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface MemoryLayout {
  /** 当前写入目录。自定义目录不可用时等于 local。 */
  memory: string;
  /** 宿主默认目录，始终参与读取。 */
  local: string;
  /** 自定义目录是否真的在用。 */
  custom: boolean;
  /** 自定义目录用不了的原因；null 表示没配或正常。 */
  problem: string | null;
  /** 用上了，但有句话要提（目前只有"新目录还是空的"）。 */
  notice: string | null;
}

/** 目录引用：存储类可以被直接给一个字符串，也可以在每次读写时问 World 当前目录。 */
export type DirRef = string | (() => string);

/** 我们自己的记忆文件名；换目录时用来判断新目录是不是空的。 */
const MEMORY_FILES = ['listening.json', 'notes.json', 'tags.json', 'taste.json', 'preferences.json', 'music-soul.md'];

export function dirValue(dir: DirRef): string {
  return typeof dir === 'function' ? dir() : dir;
}

/** 合并读取用的目录列表：当前目录在前，本机旧目录在后，同一路径只留一份。 */
export function readDirs(dir: DirRef, local?: DirRef): string[] {
  const list = [dirValue(dir), local ? dirValue(local) : ''].filter(Boolean);
  return list.filter((item, index) => list.findIndex(other => sameDir(item, other)) === index);
}

/** 路径比较统一成绝对路径，并按 Windows 的习惯忽略大小写。 */
export function sameDir(a: string, b: string): boolean {
  const norm = (p: string): string => {
    try {
      return resolve(p).replace(/[\\/]+$/, '').toLowerCase();
    } catch {
      return p.replace(/[\\/]+$/, '').toLowerCase();
    }
  };
  return norm(a) === norm(b);
}

/** 设置页「选择文件夹」的起点：用户主目录下一个好找的地方，不替他建。 */
export function suggestedMemoryDir(): string {
  try {
    return join(homedir(), 'CoopanionMusic');
  } catch {
    return '';
  }
}

/**
 * 探测目录能不能真的用来存东西。
 *
 * 不用 `accessSync(W_OK)`：网盘和移动硬盘会把权限位报得很乐观，真写下去才失败。
 * 写一个探针文件再删掉，是唯一能同时验「路径存在、有权限、盘在线」的办法。
 */
function probeWritable(dir: string): { ok: true } | { ok: false; reason: string } {
  const probe = join(dir, `.write-test-${process.pid}`);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code ?? '';
    if (code === 'ENOENT') return { ok: false, reason: '所在盘符不存在（移动硬盘拔了？网络盘没连上？）' };
    if (code === 'EPERM' || code === 'EACCES') return { ok: false, reason: '没有写入权限' };
    if (code === 'ENOTDIR') return { ok: false, reason: '路径里有一段不是文件夹' };
    return { ok: false, reason: `建不了目录（${code || '未知错误'}）` };
  }
  try {
    writeFileSync(probe, 'ok', 'utf8');
    rmSync(probe, { force: true });
    return { ok: true };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code ?? '';
    if (code === 'EROFS') return { ok: false, reason: '这个盘是只读的' };
    if (code === 'ENOSPC') return { ok: false, reason: '盘满了' };
    return { ok: false, reason: `写得进目录但写不了文件（${code || '未知错误'}）` };
  }
}

/** 目录里有没有我们自己的记忆文件；没有就是"从这里重新开始记"。 */
function freshDir(dir: string): boolean {
  try {
    const names = readdirSync(dir);
    return !names.some(name => MEMORY_FILES.includes(name));
  } catch {
    return false;
  }
}

/**
 * 把配置翻译成可用路径。
 *
 * 配置为空、等于本机目录、或者探测失败，都退回本机并给出原因——
 * 永远返回一个能用的目录，调用方不必再判空。
 */
export function resolveLayout(local: string, configured: string): MemoryLayout {
  const wanted = (configured ?? '').trim();
  if (!wanted || !local) return { memory: local, local, custom: false, problem: null, notice: null };
  if (sameDir(wanted, local)) return { memory: local, local, custom: false, problem: null, notice: null };
  const probe = probeWritable(wanted);
  if (!probe.ok) {
    return {
      memory: local, local, custom: false,
      problem: `记忆位置「${wanted}」用不了：${probe.reason}。这段时间的听歌记录照旧存在本机。`,
      notice: null,
    };
  }
  return {
    memory: wanted, local, custom: true, problem: null,
    notice: freshDir(wanted)
      ? `记忆位置切到「${wanted}」，这个目录还是空的，会从这里接着记。本机旧记录仍然读得到。`
      : null,
  };
}

/** 运行中复查用：U 盘可能在跑着的时候被拔掉。 */
export function stillWritable(dir: string): boolean {
  return probeWritable(dir).ok;
}

/** 最近一次因为自定义目录写不进去而回落到本机的时间；null 表示没发生过。 */
let fallback: { at: number; dir: string } | null = null;

export function lastWriteFallback(): { at: number; dir: string } | null {
  return fallback;
}

/** 测试用：清掉回落记录。 */
export function clearWriteFallback(): void {
  fallback = null;
}

/**
 * 写一个 JSON 文本：优先写 `memory`，失败时回落到 `local` 并把这次回落记下来。
 * 两处都失败才抛错。
 */
export async function writeTextWithFallback(memory: string, local: string, name: string, text: string): Promise<string> {
  const targets = [memory, local].filter((dir, index, list) => dir && list.findIndex(item => sameDir(dir, item)) === index);
  let lastError: unknown = null;
  for (const dir of targets) {
    try {
      await mkdir(dir, { recursive: true });
      const file = join(dir, name);
      const tmp = `${file}.tmp`;
      await writeFile(tmp, text, 'utf8');
      await rename(tmp, file);
      if (!sameDir(dir, memory)) fallback = { at: Date.now(), dir };
      return dir;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('没有可写的记忆目录');
}

/** 读取同一份文件的两处版本；当前目录在前，缺失或损坏的那份跳过。 */
export async function readJsonVariants<T>(dir: DirRef, local: DirRef | undefined, name: string): Promise<T[]> {
  const out: T[] = [];
  for (const target of readDirs(dir, local)) {
    try {
      out.push(JSON.parse(await readFile(join(target, name), 'utf8')) as T);
    } catch {
      // 没有这份文件或内容损坏：这一处不参与合并。
    }
  }
  return out;
}

/** 数据一览用：当前记忆位置的一句话。 */
export function layoutNote(layout: MemoryLayout): string {
  if (layout.problem) return layout.problem;
  if (!layout.custom) return '默认跟本机 dataDir；设置里填一个同步盘文件夹可跨机器共用。';
  return layout.notice ?? `正在使用自定义记忆目录：${layout.memory}`;
}
