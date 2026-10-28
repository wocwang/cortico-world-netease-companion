# Windows PowerShell 5.1; one UTF-8 JSON snapshot per two seconds.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

# The World sends the official players in priority order as JSON; each entry has
# id, session regex and window-process regex. Never fall back to arbitrary apps.
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
    $track = $null
    $readError = $initError
    try {
        if ($null -ne $manager) {
            $sessions = @($manager.GetSessions() | Where-Object {
                $_.GetPlaybackInfo().PlaybackStatus.ToString() -ne 'Closed'
            })
            # Walk players in priority order. A playing session wins over any
            # paused one; if nothing is playing, keep the highest-priority session.
            $selected = $null
            $selectedPlayer = ''
            foreach ($matcher in $sessionMatchers) {
                $candidates = @($sessions | Where-Object { $matcher.regex.IsMatch($_.SourceAppUserModelId) })
                if ($candidates.Count -eq 0) { continue }
                $playing = $candidates | Where-Object { $_.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing' } | Select-Object -First 1
                if ($null -ne $playing) { $selected = $playing; $selectedPlayer = $matcher.id; break }
                if ($null -eq $selected) {
                    $selected = $candidates | Select-Object -First 1
                    $selectedPlayer = $matcher.id
                }
            }
            if ($null -ne $selected) {
                $props = Await-WinRT ($selected.TryGetMediaPropertiesAsync()) $propertiesType
                if ($props.Title) {
                    $status = 'unknown'
                    switch ($selected.GetPlaybackInfo().PlaybackStatus.ToString()) {
                        'Playing' { $status = 'playing' }
                        'Paused' { $status = 'paused' }
                        'Stopped' { $status = 'paused' }
                        'Closed' { $status = 'paused' }
                    }
                    $track = @{ title = $props.Title; artist = $props.Artist; album = $props.AlbumTitle;
                        app = $selected.SourceAppUserModelId; player = $selectedPlayer; status = $status;
                        method = 'smtc'; timeline = $false }
                    try {
                        $timeline = $selected.GetTimelineProperties()
                        $position = [double]$timeline.Position.TotalSeconds
                        $end = [double]$timeline.EndTime.TotalSeconds
                        $track.positionSeconds = $position
                        if ($end -gt 0) { $track.durationSeconds = $end }
                        # Kugou and similar players expose SMTC without a timeline.
                        if ($position -gt 0 -or $end -gt 0) { $track.timeline = $true }
                    } catch {}
                }
            }
        }
    } catch { $readError = $_.Exception.Message; $manager = $null; $initError = $readError }
    if ($null -eq $track -and $env:MUSIC_WINDOW_FALLBACK -eq '1') {
        # A title alone cannot prove playback or distinguish title/artist reliably.
        $processes = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle })
        foreach ($matcher in $windowMatchers) {
            $player = $processes | Where-Object {
                $matcher.regex.IsMatch($_.ProcessName) -and
                ($_.MainWindowTitle -match '\S.*\s[-\u2013\u2014]\s.*\S' -or $_.MainWindowTitle -match '[\u4e00-\u9fff][-\u2013\u2014][\u4e00-\u9fff]') -and
                $_.MainWindowTitle -notmatch '^(\u7f51\u6613\u4e91\u97f3\u4e50|NetEase Cloud Music|QQ\u97f3\u4e50|Spotify)$'
            } | Select-Object -First 1
            if ($null -ne $player) {
                $track = @{ title = $player.MainWindowTitle; artist = ''; album = '';
                    app = $player.ProcessName; player = $matcher.id; status = 'unknown';
                    method = 'window-title'; timeline = $false }
                break
            }
        }
    }
    $result = @{ track = $track }
    if ($null -eq $track -and $readError) { $result.error = $readError }
    [Console]::WriteLine(($result | ConvertTo-Json -Compress -Depth 4))
    # A failed WinRT initialization is recoverable (service restart / login / wake).
    if ($null -eq $manager) {
        try { $manager = Await-WinRT ($managerType::RequestAsync()) $managerType; $initError = '' } catch { $initError = $_.Exception.Message }
    }
    Start-Sleep -Seconds 2
}
