import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROBE_SCRIPT = fileURLToPath(new URL('../scripts/audio-probe.ps1', import.meta.url));
const PROBE_DIR = join(tmpdir(), 'coopani-netease-audio');
const START_TIMEOUT_MS = 4000;
const CAPTURE_TIMEOUT_MS = 3000;

export interface AudioClip {
  bytes: Uint8Array;
  mime: 'audio/wav';
  name: string;
  /** 实际切片长度（秒），从 WAV 头算出。 */
  seconds: number;
  fallbackText: string;
}

/** 可替换的音频来源；测试里用假实现，正式实现走 WASAPI 回环探针。 */
export interface HearingSource {
  capture(seconds: number, signal?: AbortSignal): Promise<AudioClip | null>;
  /** World 启动时预热探针，避免第一条评论等采集器启动。 */
  warm?(): void;
  stop(): Promise<void>;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** 从 WAV 头算实际时长；采样率不一定是 48k。 */
function wavSeconds(bytes: Uint8Array): number {
  if (bytes.length < 44) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const channels = view.getUint16(22, true);
  const rate = view.getUint32(24, true);
  const bits = view.getUint16(34, true);
  const perSecond = rate * channels * (bits / 8);
  return perSecond > 0 ? Math.max(0, (bytes.length - 44) / perSecond) : 0;
}

/**
 * 系统声音回环采集。探针常驻内存保存最近 30 秒，只有真正要发评论时才写一个 WAV；
 * 不录音、不落盘、不联网，临时文件读完即删。
 */
export class WindowsHearing implements HearingSource {
  private child?: ChildProcess;
  private queue: Promise<unknown> = Promise.resolve();
  private starting?: Promise<boolean>;
  private retryAt = 0;
  private stopped = false;
  private readonly dir = PROBE_DIR;
  private readonly ready = join(PROBE_DIR, 'capture.ready');
  private readonly request = join(PROBE_DIR, 'capture.request');
  private readonly wav = join(PROBE_DIR, 'capture.wav');
  private readonly errorFile = join(PROBE_DIR, 'capture.error');

  warm(): void {
    void this.ensureProbe();
  }

  capture(seconds: number, signal?: AbortSignal): Promise<AudioClip | null> {
    const run = async () => {
      if (this.stopped || signal?.aborted) return null;
      return this.captureOnce(seconds, signal);
    };
    const result = this.queue.then(run, run);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private clean(): void {
    for (const file of [this.request, this.wav, `${this.wav}.tmp`, this.errorFile])
      rmSync(file, { force: true });
  }

  private async ensureProbe(): Promise<boolean> {
    if (this.child && this.child.exitCode === null && !this.child.killed) return true;
    if (this.stopped || process.platform !== 'win32' || Date.now() < this.retryAt) return false;
    if (!this.starting) this.starting = this.startProbe().finally(() => { this.starting = undefined; });
    return this.starting;
  }

  private async startProbe(): Promise<boolean> {
    mkdirSync(this.dir, { recursive: true });
    this.clean();
    rmSync(this.ready, { force: true });
    let child: ChildProcess;
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PROBE_SCRIPT,
        '-Dir', this.dir, '-ParentPid', String(process.pid)], { windowsHide: true, stdio: 'ignore' });
    } catch {
      this.retryAt = Date.now() + 30_000;
      return false;
    }
    this.child = child;
    child.once('exit', () => { if (this.child === child) this.child = undefined; });
    child.once('error', () => { if (this.child === child) this.child = undefined; });
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (existsSync(this.ready)) return true;
      if (this.stopped) break;
      await sleep(120);
    }
    child.kill();
    this.retryAt = Date.now() + 30_000;
    return false;
  }

  private async captureOnce(seconds: number, signal?: AbortSignal): Promise<AudioClip | null> {
    if (!(await this.ensureProbe())) return null;
    this.clean();
    try {
      writeFileSync(this.request, String(Math.round(seconds)), 'ascii');
      const deadline = Date.now() + CAPTURE_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (signal?.aborted || this.stopped) { this.clean(); return null; }
        if (existsSync(this.errorFile)) {
          this.clean();
          return null;
        }
        if (existsSync(this.wav)) {
          const size = statSync(this.wav).size;
          if (size > 44) {
            const bytes = new Uint8Array(readFileSync(this.wav));
            const seconds = Math.round(wavSeconds(bytes) * 10) / 10;
            this.clean();
            return {
              bytes,
              mime: 'audio/wav',
              name: `music-${Date.now()}.wav`,
              seconds,
              fallbackText: `最近 ${Math.round(seconds)} 秒系统声音（WAV）；只有支持音频输入的模型才能听到，否则请忽略。`,
            };
          }
        }
        await sleep(100);
      }
    } catch {
      // 采集失败按没有音频处理，不影响文字评论。
    }
    this.clean();
    return null;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.child?.kill();
    this.child = undefined;
    this.clean();
    rmSync(this.ready, { force: true });
  }
}
