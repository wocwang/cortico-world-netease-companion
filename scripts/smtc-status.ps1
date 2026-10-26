# Windows PowerShell 5.1; one-shot JSON snapshot for the connection check panel.
# Reads installed/running music apps and the SMTC sessions Windows currently exposes.
# ASCII-only: PowerShell 5.1 reads this file without a UTF-8 BOM as ANSI.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -AssemblyName System.Runtime.WindowsRuntime
function Await-WinRT($operation, $resultType) {
    $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
    $task = $method.MakeGenericMethod($resultType).Invoke($null, @($operation))
    if (-not $task.Wait(5000)) { throw 'Windows media API timeout' }
    return $task.Result
}

$sessions = @()
$errorText = ''
try {
    $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
    $propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
    $manager = Await-WinRT ($managerType::RequestAsync()) $managerType
    foreach ($session in $manager.GetSessions()) {
        $playback = $session.GetPlaybackInfo().PlaybackStatus.ToString()
        if ($playback -eq 'Closed') { continue }
        $title = ''
        $artist = ''
        try {
            $props = Await-WinRT ($session.TryGetMediaPropertiesAsync()) $propsType
            $title = $props.Title
            $artist = $props.Artist
        } catch {}
        $sessions += @{ app = $session.SourceAppUserModelId; status = $playback; title = $title; artist = $artist }
    }
} catch {
    $errorText = $_.Exception.Message
}

$apps = @(
    @{ id = 'netease'; name = 'NetEase Cloud Music'; installed = $false; running = $false; version = ''; path = '' },
    @{ id = 'qqmusic'; name = 'QQ Music'; installed = $false; running = $false; version = ''; path = '' }
)

# DisplayName regexes use .NET \u escapes so this file stays ASCII.
$neteaseName = '\u7f51\u6613\u4e91\u97f3\u4e50'
$qqName = 'QQ\u97f3\u4e50'
$uninstallRoots = @(
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
foreach ($root in $uninstallRoots) {
    foreach ($item in (Get-ItemProperty $root -ErrorAction SilentlyContinue)) {
        if ($item.DisplayName -match $neteaseName) {
            $apps[0].installed = $true
            $apps[0].version = [string]$item.DisplayVersion
            $apps[0].path = [string]$item.DisplayIcon
        } elseif ($item.DisplayName -match $qqName) {
            $apps[1].installed = $true
            $apps[1].version = [string]$item.DisplayVersion
            if ($item.InstallLocation) { $apps[1].path = [string]$item.InstallLocation } else { $apps[1].path = [string]$item.DisplayIcon }
        }
    }
}

foreach ($process in @(Get-Process -ErrorAction SilentlyContinue | Select-Object ProcessName)) {
    if ($process.ProcessName -match 'cloudmusic') { $apps[0].running = $true }
    if ($process.ProcessName -match 'QQMusic') { $apps[1].running = $true }
}

if (-not $apps[0].installed -and (Test-Path "$env:LOCALAPPDATA\Netease\CloudMusic")) { $apps[0].installed = $true }
if (-not $apps[1].installed -and (Test-Path "$env:LOCALAPPDATA\Tencent\QQMusic")) { $apps[1].installed = $true }

@{ sessions = $sessions; apps = $apps; error = $errorText } | ConvertTo-Json -Compress -Depth 6
