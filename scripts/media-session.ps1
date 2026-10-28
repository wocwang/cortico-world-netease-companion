# Windows PowerShell 5.1; one UTF-8 JSON snapshot per two seconds.
# Reports every official-player SMTC session and window-title candidate.
# Priority and stickiness are decided in TypeScript (src/selection.ts).
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$players = @()
$playersJson = $env:MUSIC_PLAYER_ORDER
if ($playersJson) {
    try { $players = @($playersJson | ConvertFrom-Json) } catch { throw 'Invalid MUSIC_PLAYER_ORDER JSON' }
}
$players = @($players | Where-Object { $_.id -and $_.session })
if ($players.Count -eq 0) {
    $players = @(
        @{ id = 'netease'; session = 'cloudmusic|netease'; window = 'cloudmusic|netease' },
        @{ id = 'qq'; session = 'qqmusic'; window = 'qqmusic' }
    )
}
$sessionMatchers = @()
$windowMatchers = @()
foreach ($player in $players) {
    try {
        $sessionMatchers += @{
            id = [string]$player.id
            regex = [regex]::new([string]$player.session, [Text.RegularExpressions.RegexOptions]::IgnoreCase, [TimeSpan]::FromMilliseconds(100))
        }
    } catch { throw 'Invalid player session regex' }
    if ($player.window) {
        try {
            $windowMatchers += @{
                id = [string]$player.id
                regex = [regex]::new([string]$player.window, [Text.RegularExpressions.RegexOptions]::IgnoreCase, [TimeSpan]::FromMilliseconds(100))
            }
        } catch { throw 'Invalid player window regex' }
    }
}

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
$manager = $null
$initError = ''
try {
    $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
    $propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
    $manager = Await-WinRT ($managerType::RequestAsync()) $managerType
} catch { $initError = $_.Exception.Message }

while ($true) {
    $sessions = @()
    $windowCandidates = @()
    $readError = $initError
    try {
        if ($null -ne $manager) {
            $allSessions = @($manager.GetSessions() | Where-Object {
                $_.GetPlaybackInfo().PlaybackStatus.ToString() -ne 'Closed'
            })
            $seenApps = @{}
            foreach ($matcher in $sessionMatchers) {
                foreach ($session in $allSessions) {
                    if (-not $matcher.regex.IsMatch($session.SourceAppUserModelId)) { continue }
                    if ($seenApps.ContainsKey($session.SourceAppUserModelId)) { continue }
                    $seenApps[$session.SourceAppUserModelId] = $true
                    try {
                        $props = Await-WinRT ($session.TryGetMediaPropertiesAsync()) $propertiesType
                        if (-not $props.Title) { continue }
                        $status = 'unknown'
                        switch ($session.GetPlaybackInfo().PlaybackStatus.ToString()) {
                            'Playing' { $status = 'playing' }
                            'Paused' { $status = 'paused' }
                            'Stopped' { $status = 'paused' }
                        }
                        $candidate = @{
                            app = $session.SourceAppUserModelId; player = $matcher.id; status = $status;
                            title = $props.Title; artist = $props.Artist; album = $props.AlbumTitle; timeline = $false
                        }
                        try {
                            $timeline = $session.GetTimelineProperties()
                            $position = [double]$timeline.Position.TotalSeconds
                            $end = [double]$timeline.EndTime.TotalSeconds
                            $candidate.positionSeconds = $position
                            if ($end -gt 0) { $candidate.durationSeconds = $end }
                            if ($position -gt 0 -or $end -gt 0) { $candidate.timeline = $true }
                        } catch {}
                        $sessions += $candidate
                    } catch { }
                }
            }
        }
    } catch {
        $readError = $_.Exception.Message
        $manager = $null
        $initError = $readError
        $sessions = @()
    }
    if ($env:MUSIC_WINDOW_FALLBACK -eq '1') {
        # A title alone cannot prove playback or distinguish title/artist reliably.
        # Emit one candidate per official player so TypeScript can apply priority.
        $processes = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle })
        foreach ($matcher in $windowMatchers) {
            $player = $processes | Where-Object {
                $matcher.regex.IsMatch($_.ProcessName) -and
                ($_.MainWindowTitle -match '\S.*\s[-\u2013\u2014]\s.*\S' -or $_.MainWindowTitle -match '[\u4e00-\u9fff][-\u2013\u2014][\u4e00-\u9fff]') -and
                $_.MainWindowTitle -notmatch '^(\u7f51\u6613\u4e91\u97f3\u4e50|NetEase Cloud Music|QQ\u97f3\u4e50|Spotify)$'
            } | Select-Object -First 1
            if ($null -ne $player) {
                $windowCandidates += @{ app = $player.ProcessName; player = $matcher.id; title = $player.MainWindowTitle }
            }
        }
    }
    $result = @{ sessions = $sessions; windowCandidates = $windowCandidates; error = $readError }
    [Console]::WriteLine(($result | ConvertTo-Json -Compress -Depth 6))
    # A failed WinRT initialization is recoverable (service restart / login / wake).
    if ($null -eq $manager) {
        try { $manager = Await-WinRT ($managerType::RequestAsync()) $managerType; $initError = '' } catch { $initError = $_.Exception.Message }
    }
    Start-Sleep -Seconds 2
}
