# Windows PowerShell 5.1; one UTF-8 JSON snapshot per two seconds.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$pattern = $env:MUSIC_SESSION_PATTERN
if (-not $pattern) { $pattern = 'cloudmusic|netease|QQMusic|qqmusic' }
try { $appRegex = [regex]::new($pattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase, [TimeSpan]::FromMilliseconds(100)) } catch { throw 'Invalid MUSIC_SESSION_PATTERN regex' }
$windowPattern = $env:MUSIC_WINDOW_PROCESS
if (-not $windowPattern) { $windowPattern = 'cloudmusic|QQMusic|qqmusic' }
try { $windowRegex = [regex]::new($windowPattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase, [TimeSpan]::FromMilliseconds(100)) } catch { throw 'Invalid MUSIC_WINDOW_PROCESS regex' }
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
            $matches = @($manager.GetSessions() | Where-Object {
                $appRegex.IsMatch($_.SourceAppUserModelId) -and $_.GetPlaybackInfo().PlaybackStatus.ToString() -ne 'Closed'
            } | Sort-Object SourceAppUserModelId | Select-Object -First 8)
            # Prefer a playing matching session; never pick an unrelated player.
            $selected = $matches | Where-Object { $_.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing' } | Select-Object -First 1
            if ($null -eq $selected) { $selected = $matches | Select-Object -First 1 }
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
                        app = $selected.SourceAppUserModelId; status = $status; method = 'smtc' }
                    try { $track.positionSeconds = $selected.GetTimelineProperties().Position.TotalSeconds } catch {}
                }
            }
        }
    } catch { $readError = $_.Exception.Message; $manager = $null; $initError = $readError }
    if ($null -eq $track -and $env:MUSIC_WINDOW_FALLBACK -eq '1') {
        # A title alone cannot prove playback or distinguish title/artist reliably.
        $player = Get-Process -ErrorAction SilentlyContinue |
            Where-Object { $windowRegex.IsMatch($_.ProcessName) -and $_.MainWindowTitle -and ($_.MainWindowTitle -match '\S.*\s[-\u2013\u2014]\s.*\S' -or $_.MainWindowTitle -match '[\u4e00-\u9fff][-\u2013\u2014][\u4e00-\u9fff]') -and $_.MainWindowTitle -notmatch '^(\u7f51\u6613\u4e91\u97f3\u4e50|NetEase Cloud Music)$' } |
            Select-Object -First 1
        if ($null -ne $player) {
            $track = @{ title = $player.MainWindowTitle; artist = ''; album = '';
                app = $player.ProcessName; status = 'unknown'; method = 'window-title' }
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
