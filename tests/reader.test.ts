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

test('读取器按优先级把官方播放器清单传给 PowerShell', async () => {
  let captured: any;
  const child = new FakeChild();
  const fakeSpawn = ((cmd: string, args: string[], opts: any) => {
    captured = { cmd, args, opts };
    return child;
  }) as any;
  const cfg = { ...defaults(), playerPriority: ['qq', 'netease'], windowFallback: true };
  const reader = new WindowsReader(cfg, fakeSpawn, { heartbeatMs: 999999, checkMs: 999999, retryMs: 999999 });
  reader.start(() => {}, () => {});
  assert.equal(captured.cmd, 'powershell.exe');
  assert.match(captured.args.join(' '), /media-session\.ps1/);
  const players = JSON.parse(captured.opts.env.MUSIC_PLAYER_ORDER);
  assert.deepEqual(players.map((item: any) => item.id), ['qq', 'netease', 'kugou', 'kuwo', 'spotify']);
  assert.ok(players.every((item: any) => item.session && item.window));
  assert.equal(captured.opts.env.MUSIC_WINDOW_FALLBACK, '1');
  assert.equal(captured.opts.env.MUSIC_SESSION_PATTERN, undefined);
  await reader.stop();
});

test('preflight 归一化播放器优先级并补齐官方项', () => {
  const patches: any[] = [];
  definition.preflight!({
    cfg: { ...defaults(), playerPriority: ['spotify', 'unknown', 'spotify'] },
    persist: (patch: any) => patches.push(patch),
  } as any);
  assert.deepEqual(patches, [{ playerPriority: ['spotify', 'netease', 'qq', 'kugou', 'kuwo'] }]);
  const explicit: any[] = [];
  definition.preflight!({ cfg: defaults(), persist: (patch: any) => explicit.push(patch) } as any);
  assert.deepEqual(explicit, []);
});
