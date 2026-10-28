import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const skip = process.platform !== 'win32' ? '仅 Windows 需要 PowerShell' : false;

test('players.ps1 把 JSON 数组展开成多个播放器（PowerShell 5.1）', { skip }, () => {
  const helper = fileURLToPath(new URL('../scripts/players.ps1', import.meta.url));
  const command = `. '${helper}'; $list = @(Read-PlayerList $env:TEST_PLAYER_ORDER); $list.Count; $list | ForEach-Object { $_.id }`;
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive',
    '-ExecutionPolicy', 'Bypass', '-Command', command], {
    env: {
      ...process.env,
      TEST_PLAYER_ORDER: JSON.stringify([
        { id: 'netease', session: 'cloudmusic|netease' },
        { id: 'qq', session: 'qqmusic' },
      ]),
    },
    encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/), ['2', 'netease', 'qq']);
});
