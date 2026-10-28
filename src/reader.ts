import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { playerEnv, playerOrder, type MusicConfig } from './config.ts';
import { TrackSelector, type Selection, type SelectorState } from './selection.ts';
import { parseCandidates, parseSnapshot, type MediaCandidates, type SessionCandidate, type Snapshot, type WindowCandidate } from './state.ts';

export interface ReaderDiagnostics {
  running: boolean;
  updatedAt: number | null;
  sessions: SessionCandidate[];
  windows: WindowCandidate[];
  selection: Selection | null;
  selector: SelectorState;
  invalidPlayers: string[];
  error: string;
}
export interface Reader {
  start(onSnapshot: (s: Snapshot) => void, onError: (message: string) => void): void;
  stop(): Promise<void>;
  diagnostics?(): ReaderDiagnostics;
}
export class WindowsReader implements Reader {
  private child?: ChildProcess;
  private stopping = false;
  private restart?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setInterval>;
  private generation = 0;
  private failures = 0;
  private selector = new TrackSelector();
  private running = false;
  private updatedAt = 0;
  private latest: MediaCandidates = { sessions: [], windows: [] };
  private latestSelection: Selection | null = null;
  private latestInvalid: string[] = [];
  private latestError = '';
  constructor(private cfg: MusicConfig, private launchProcess: typeof spawn = spawn,
    private timing = { heartbeatMs: 20_000, checkMs: 5000, retryMs: 2000 }) {}
  start(onSnapshot: (s: Snapshot) => void, onError: (message: string) => void): void {
    if (this.child || this.restart || this.watchdog) return;
    this.stopping = false;
    this.selector.reset();
    const generation = ++this.generation;
    const launch = () => {
      this.restart = undefined;
      if (this.stopping || generation !== this.generation) return;
      let lastSnapshot = Date.now();
      const child = this.child = this.launchProcess('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive',
        '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('../scripts/media-session.ps1', import.meta.url))], {
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, MUSIC_PLAYER_ORDER: playerEnv(this.cfg.playerPriority),
          MUSIC_WINDOW_FALLBACK: this.cfg.windowFallback ? '1' : '0' },
      });
      this.running = true;
      let lineBytes = 0;
      child.stdout!.on('data', (chunk: Buffer) => {
        for (const byte of chunk) {
          lineBytes = byte === 10 ? 0 : lineBytes + 1;
          if (lineBytes > 65_536) { onError('媒体读取器数据过大，正在重连'); child.kill(); child.stdout!.destroy(); break; }
        }
      });
      const lines = createInterface({ input: child.stdout! });
      lines.on('line', line => {
        if (this.stopping || generation !== this.generation || this.child !== child) return;
        if (line.length > 32_768) { onError('媒体读取器数据过大，正在重连'); child.kill(); return; }
        try {
          const raw = JSON.parse(line) as Record<string, unknown>;
          lastSnapshot = Date.now();
          this.failures = 0;
          this.updatedAt = Date.now();
          if (Array.isArray(raw.sessions) || Array.isArray(raw.windowCandidates)) {
            const candidates = parseCandidates(raw);
            this.latest = candidates;
            this.latestError = candidates.error ?? '';
            const allowed = new Set(playerOrder(this.cfg.playerPriority));
            this.latestInvalid = [...new Set(
              [...candidates.sessions, ...candidates.windows].map(item => item.player).filter(id => !allowed.has(id)),
            )];
            this.latestSelection = this.selector.select(this.cfg.playerPriority, candidates.sessions, candidates.windows);
            onSnapshot({ track: this.latestSelection?.track ?? null, error: candidates.error });
          } else {
            this.latest = { sessions: [], windows: [] };
            this.latestSelection = null;
            this.latestInvalid = [];
            this.latestError = '';
            onSnapshot(parseSnapshot(raw));
          }
        } catch { onError('媒体读取器返回了无法识别的数据'); }
      });
      this.watchdog = setInterval(() => {
        if (Date.now() - lastSnapshot > this.timing.heartbeatMs) { onError('媒体读取超时无响应，正在重连'); child.kill(); }
      }, this.timing.checkMs);
      child.stderr?.on('data', () => { if (generation === this.generation && !this.stopping) onError('媒体读取器报告错误，请运行 npm run diagnose 查看本机输出'); });
      child.on('error', e => { if (!this.stopping && generation === this.generation) onError(e.message); });
      child.on('close', () => {
        lines.close();
        if (this.child !== child || generation !== this.generation) return;
        this.running = false;
        this.latest = { sessions: [], windows: [] };
        this.latestSelection = null;
        this.latestInvalid = [];
        clearInterval(this.watchdog);
        this.watchdog = undefined;
        this.child = undefined;
        if (!this.stopping) {
          const delay = Math.min(60_000, this.timing.retryMs * 2 ** Math.min(this.failures++, 5));
          onError(`媒体读取器退出，${delay / 1000} 秒后重试`);
          this.restart = setTimeout(launch, delay);
        }
      });
    };
    launch();
  }
  diagnostics(): ReaderDiagnostics {
    return {
      running: this.running,
      updatedAt: this.updatedAt || null,
      sessions: this.latest.sessions,
      windows: this.latest.windows,
      selection: this.latestSelection,
      selector: this.selector.state(),
      invalidPlayers: this.latestInvalid,
      error: this.latestError,
    };
  }
  async stop(): Promise<void> {
    this.stopping = true;
    this.running = false;
    this.latest = { sessions: [], windows: [] };
    this.latestSelection = null;
    this.latestInvalid = [];
    ++this.generation;
    clearTimeout(this.restart);
    this.restart = undefined;
    clearInterval(this.watchdog);
    this.watchdog = undefined;
    const child = this.child;
    if (!child || child.exitCode !== null) return;
    await new Promise<void>(resolve => {
      const timeout = setTimeout(resolve, 2000);
      child.once('close', () => { clearTimeout(timeout); resolve(); });
      child.kill();
    });
    this.child = undefined;
  }
}
