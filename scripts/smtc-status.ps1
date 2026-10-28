# Windows PowerShell 5.1; one-shot JSON snapshot for the connection check panel.
# Reads installed/running official music apps and the SMTC sessions Windows exposes.
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
    @{ id = 'qq'; name = 'QQ Music'; installed = $false; running = $false; version = ''; path = '' },
    @{ id = 'kugou'; name = 'Kugou Music'; installed = $false; running = $false; version = ''; path = '' },
    @{ id = 'kuwo'; name = 'Kuwo Music'; installed = $false; running = $false; version = ''; path = '' },
    @{ id = 'spotify'; name = 'Spotify'; installed = $false; running = $false; version = ''; path = '' }
)

# DisplayName regexes use .NET \u escapes so this file stays ASCII.
$displayNames = @(
    @{ index = 0; regex = '\u7f51\u6613\u4e91\u97f3\u4e50' },
    @{ index = 1; regex = 'QQ\u97f3\u4e50' },
    @{ index = 2; regex = '\u9177\u72d7\u97f3\u4e50' },
    @{ index = 3; regex = '\u9177\u6211\u97f3\u4e50' },
    @{ index = 4; regex = '^Spotify' }
)
$uninstallRoots = @(
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
foreach ($root in $uninstallRoots) {
    foreach ($item in (Get-ItemProperty $root -ErrorAction SilentlyContinue)) {
        foreach ($name in $displayNames) {
            if ($item.DisplayName -match $name.regex) {
                $app = $apps[$name.index]
                $app.installed = $true
                $app.version = [string]$item.DisplayVersion
                if ($item.InstallLocation) { $app.path = [string]$item.InstallLocation } else { $app.path = [string]$item.DisplayIcon }
            }
        }
    }
}

$processNames = @(Get-Process -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName)
$processPatterns = @(
    @{ index = 0; regex = 'cloudmusic' },
    @{ index = 1; regex = 'QQMusic' },
    @{ index = 2; regex = 'KuGou' },
    @{ index = 3; regex = 'kwmusic|Kuwo' },
    @{ index = 4; regex = '^Spotify' }
)
foreach ($pattern in $processPatterns) {
    if (@($processNames | Where-Object { $_ -match $pattern.regex }).Count -gt 0) { $apps[$pattern.index].running = $true }
}

$installPaths = @(
    @{ index = 0; paths = @("$env:LOCALAPPDATA\Netease\CloudMusic") },
    @{ index = 1; paths = @("$env:LOCALAPPDATA\Tencent\QQMusic") },
    @{ index = 2; paths = @("$env:ProgramFiles\KuGou", "${env:ProgramFiles(x86)}\KuGou") },
    @{ index = 3; paths = @("$env:ProgramFiles\Kuwo", "${env:ProgramFiles(x86)}\Kuwo") },
    @{ index = 4; paths = @("$env:APPDATA\Spotify\Spotify.exe", "$env:LOCALAPPDATA\Microsoft\WindowsApps\Spotify.exe") }
)
foreach ($check in $installPaths) {
    if ($apps[$check.index].installed) { continue }
    foreach ($path in $check.paths) {
        if ($path -and (Test-Path $path)) { $apps[$check.index].installed = $true; break }
    }
}

@{ sessions = $sessions; apps = $apps; error = $errorText } | ConvertTo-Json -Compress -Depth 6
