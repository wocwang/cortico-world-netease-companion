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

test('读取器用候选协议按优先级选择并上报诊断', async () => {
  const child = new FakeChild();
  const snapshots: any[] = [];
  const reader = new WindowsReader(defaults(), (() => child) as any,
    { heartbeatMs: 999999, checkMs: 999999, retryMs: 999999 });
  reader.start(snapshot => snapshots.push(snapshot), () => {});
  const send = (value: unknown) => new Promise<void>(resolve => {
    child.stdout.write(JSON.stringify(value) + '\n', () => resolve());
  });
  const wait = () => new Promise(resolve => setTimeout(resolve, 20));
  const qq = { app: 'QQMusic.exe', player: 'qq', status: 'playing', title: '晴天', artist: '周杰伦',
    album: '叶惠美', timeline: true, durationSeconds: 269 };
  const netease = { app: 'cloudmusic.exe', player: 'netease', status: 'playing', title: '晴天', artist: '周杰伦',
    album: '叶惠美', timeline: true, durationSeconds: 269 };

  await send({ sessions: [qq], windowCandidates: [] });
  await wait();
  assert.equal(snapshots.at(-1)?.track?.player, 'qq');
  assert.equal(reader.diagnostics().selection?.player, 'qq');
  assert.equal(reader.diagnostics().sessions.length, 1);

  await send({ sessions: [qq, netease], windowCandidates: [] });
  await wait();
  assert.equal(snapshots.at(-1)?.track?.player, 'qq');
  assert.equal(reader.diagnostics().selector.pending?.player, 'netease');

  await send({ sessions: [qq, netease], windowCandidates: [] });
  await wait();
  assert.equal(snapshots.at(-1)?.track?.player, 'netease');
  await reader.stop();
  assert.equal(reader.diagnostics().running, false);
});

test('读取器把无法识别的播放器标识记入诊断', async () => {
  const child = new FakeChild();
  const snapshots: any[] = [];
  const reader = new WindowsReader(defaults(), (() => child) as any,
    { heartbeatMs: 999999, checkMs: 999999, retryMs: 999999 });
  reader.start(snapshot => snapshots.push(snapshot), () => {});
  await new Promise<void>(resolve => {
    child.stdout.write(JSON.stringify({
      sessions: [{ app: 'cloudmusic.exe', player: 'netease qq', status: 'playing', title: '晴天',
        artist: '周杰伦', album: '', timeline: false }],
      windowCandidates: [],
    }) + '\n', () => resolve());
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(snapshots.at(-1)?.track, null);
  assert.equal(reader.diagnostics().selection, null);
  assert.deepEqual(reader.diagnostics().invalidPlayers, ['netease qq']);
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
