import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { WindowsReader } from '../src/reader.ts';
import { defaults } from '../src/config.ts';
import definition from '../src/index.ts';

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  kill(): boolean {
    this.exitCode = 0;
    this.emit('close');
    return true;
  }
}

test('读取器把媒体会话与窗口降级进程配置传给 PowerShell', async () => {
  let captured: any;
  const child = new FakeChild();
  const fakeSpawn = ((cmd: string, args: string[], opts: any) => {
    captured = { cmd, args, opts };
    return child;
  }) as any;
  const cfg = { ...defaults(), sessionPattern: 'QQMusic|cloudmusic', windowFallbackProcess: 'QQMusic|cloudmusic' };
  const reader = new WindowsReader(cfg, fakeSpawn, { heartbeatMs: 999999, checkMs: 999999, retryMs: 999999 });
  reader.start(() => {}, () => {});
  assert.equal(captured.cmd, 'powershell.exe');
  assert.match(captured.args.join(' '), /media-session\.ps1/);
  assert.equal(captured.opts.env.MUSIC_SESSION_PATTERN, 'QQMusic|cloudmusic');
  assert.equal(captured.opts.env.MUSIC_WINDOW_PROCESS, 'QQMusic|cloudmusic');
  assert.equal(captured.opts.env.MUSIC_WINDOW_FALLBACK, '1');
  await reader.stop();
});

test('preflight 迁移旧默认并校验窗口进程正则', () => {
  const patches: any[] = [];
  const oldCfg = { ...defaults(), sessionPattern: 'cloudmusic|netease|网易云', windowFallbackProcess: '' };
  definition.preflight!({ cfg: oldCfg, persist: (patch: any) => patches.push(patch) } as any);
  assert.deepEqual(patches[0], { sessionPattern: 'cloudmusic|netease|网易云|QQMusic|qqmusic' });
  assert.deepEqual(patches[1], { windowFallbackProcess: 'cloudmusic|QQMusic|qqmusic' });
  const explicit: any[] = [];
  definition.preflight!({
    cfg: { ...defaults(), sessionPattern: 'cloudmusic|netease|网易云', windowFallbackProcess: 'cloudmusic' },
    persist: (patch: any) => explicit.push(patch),
  } as any);
  assert.deepEqual(explicit, [{ sessionPattern: 'cloudmusic|netease|网易云|QQMusic|qqmusic' }]);
  assert.throws(() => definition.preflight!({
    cfg: { ...defaults(), sessionPattern: '[' }, persist: () => {},
  } as any), /媒体会话应用名匹配/);
  assert.throws(() => definition.preflight!({
    cfg: { ...defaults(), windowFallbackProcess: '[' }, persist: () => {},
  } as any), /窗口标题降级进程名匹配/);
});
