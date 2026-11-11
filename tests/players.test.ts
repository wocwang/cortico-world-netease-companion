import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('players.ps1 精确比较应用 ID，AUMID 里的 [ * ? 不当通配符', { skip }, () => {
  const helper = fileURLToPath(new URL('../scripts/players.ps1', import.meta.url));
  const command = [
    `. '${helper}'`,
    "Test-AppIdMatch 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify' 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify'",
    "Test-AppIdMatch 'cloudmusic' 'cloudmusic.exe'",
    "Test-AppIdMatch 'cloudmusic.exe' 'cloudmusic'",
    "Test-AppIdMatch 'Weird[1]*?.exe' 'Weird[1]*?'",
    // 含通配符的 ID 只匹配它自己，不能吞掉别的会话。
    "Test-AppIdMatch 'WeirdXYZ' 'Weird[1]*?'",
    "Test-AppIdMatch 'Another[App]' 'Weird[1]*?'",
    "Test-AppIdMatch '' 'cloudmusic'",
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive',
    '-ExecutionPolicy', 'Bypass', '-Command', command], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/).map(line => line.trim()),
    ['True', 'True', 'True', 'True', 'False', 'False', 'False']);
});

test('所有 PowerShell 脚本保持 ASCII（5.1 无 BOM 时按 ANSI 解析）', async () => {
  const dir = fileURLToPath(new URL('../scripts/', import.meta.url));
  for (const name of await readdir(dir)) {
    if (!name.toLowerCase().endsWith('.ps1')) continue;
    const bytes = await readFile(join(dir, name));
    assert.equal(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, false, `${name} 不应带 UTF-8 BOM`);
    const bad = bytes.findIndex(byte => byte > 0x7f);
    assert.equal(bad, -1, `${name} 第 ${bad + 1} 字节不是 ASCII，PowerShell 5.1 会按 ANSI 解析成乱码`);
  }
});

test('PowerShell 5.1 能解析全部脚本，中文路径下也能执行', { skip }, async () => {
  const src = fileURLToPath(new URL('../scripts', import.meta.url));
  const dir = await mkdtemp(join(tmpdir(), 'ting-dazi-'));
  try {
    const target = join(dir, '听搭子 脚本');
    await cp(src, target, { recursive: true });
    const parse = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive',
      '-ExecutionPolicy', 'Bypass', '-Command',
      `$bad = 0; Get-ChildItem -LiteralPath '${target}' -Filter *.ps1 | ForEach-Object {
         $tokens = $null; $errors = $null;
         [void][System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$tokens, [ref]$errors);
         if ($errors.Count -gt 0) { Write-Output ($_.Name + ': ' + $errors[0].Message); $bad = 1 }
       }; if ($bad) { exit 1 } else { 'OK' }`], { encoding: 'utf8', windowsHide: true });
    assert.equal(parse.status, 0, parse.stdout + parse.stderr);
    assert.equal(parse.stdout.trim(), 'OK');
    // 从中文路径执行脚本并调用函数，覆盖路径编码与脚本解析。
    const run = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive',
      '-ExecutionPolicy', 'Bypass', '-Command',
      `. '${join(target, 'players.ps1')}'; if (Test-AppIdMatch 'a[b]*?' 'a[b]*?') { 'OK' }`],
    { encoding: 'utf8', windowsHide: true });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), 'OK');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
