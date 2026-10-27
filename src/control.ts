import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const CONTROL_SCRIPT = fileURLToPath(new URL('../scripts/control.ps1', import.meta.url));
export type ControlAction = 'pause' | 'resume' | 'next' | 'prev';

export interface ControlResult {
  ok: boolean;
  app?: string;
  status?: string;
  title?: string;
  artist?: string;
  error?: string;
}

/** 一次性调用播放器的 SMTC 控制接口；失败以结果返回，不抛出。 */
export function runControl(action: ControlAction, match = '', timeoutMs = 10_000): Promise<ControlResult> {
  return new Promise(resolve => {
    if (!existsSync(CONTROL_SCRIPT)) return resolve({ ok: false, error: '控制脚本不存在' });
    execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', CONTROL_SCRIPT, '-Action', action, ...(match ? ['-Match', match] : [])],
      { timeout: timeoutMs, windowsHide: true, encoding: 'utf8' },
      (error, stdout) => {
        if (error && !stdout) return resolve({ ok: false, error: error.message.slice(0, 200) });
        const line = String(stdout).split(/\r?\n/).map(value => value.trim()).filter(value => value.startsWith('{')).pop();
        if (!line) return resolve({ ok: false, error: '播放器没有回应' });
        try {
          const parsed = JSON.parse(line) as ControlResult;
          return resolve({ ...parsed, ok: parsed.ok === true });
        } catch {
          return resolve({ ok: false, error: '播放器的回应读不懂' });
        }
      },
    );
  });
}
