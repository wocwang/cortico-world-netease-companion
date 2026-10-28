param(
  [Parameter(Mandatory = $true)][ValidateSet('pause', 'resume', 'next', 'prev')][string]$Action,
  [string]$Match = '',
  [string]$Player = '',
  [string]$Session = '',
  [string]$Priority = ''
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'players.ps1')

try {
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
} catch { }

function Write-Result($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
}

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]

  function Await($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
  }

  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  $propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
  $manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

  $sessions = @($manager.GetSessions() | Where-Object { "$($_.GetPlaybackInfo().PlaybackStatus)" -ne 'Closed' })
  if ($sessions.Count -eq 0) {
    Write-Result ([ordered]@{ ok = $false; error = 'No controllable media session' })
    exit 0
  }

  $selected = $null
  $selectedPlayer = ''
  # 1) Prefer the current player's session so multi-player setups do not control the wrong app.
  if ($Session) {
    try {
      $sessionRegex = [regex]::new($Session, [Text.RegularExpressions.RegexOptions]::IgnoreCase, [TimeSpan]::FromMilliseconds(100))
    } catch {
      Write-Result ([ordered]@{ ok = $false; error = 'Invalid session regex'; player = '' })
      exit 0
    }
    $current = @($sessions | Where-Object { $sessionRegex.IsMatch($_.SourceAppUserModelId) })
    if ($current.Count -gt 0) {
      $selected = $current | Where-Object { "$($_.GetPlaybackInfo().PlaybackStatus)" -eq 'Playing' } | Select-Object -First 1
      if ($null -eq $selected) { $selected = $current[0] }
      $selectedPlayer = if ($Player) { $Player } else { 'current' }
    } else {
      Write-Result ([ordered]@{ ok = $false; error = 'Current player has no controllable media session'; player = '' })
      exit 0
    }
  }
  # 2) If the current player is unknown, follow the configured priority and prefer a playing session.
  if ($null -eq $selected -and $Priority) {
    try {
      $players = @(Read-PlayerList $Priority)
    } catch {
      Write-Result ([ordered]@{ ok = $false; error = 'Invalid priority JSON'; player = '' })
      exit 0
    }
    foreach ($player in $players) {
      try {
        $playerRegex = [regex]::new([string]$player.session, [Text.RegularExpressions.RegexOptions]::IgnoreCase, [TimeSpan]::FromMilliseconds(100))
      } catch { continue }
      $candidates = @($sessions | Where-Object { $playerRegex.IsMatch($_.SourceAppUserModelId) })
      if ($candidates.Count -eq 0) { continue }
      $selected = $candidates | Where-Object { "$($_.GetPlaybackInfo().PlaybackStatus)" -eq 'Playing' } | Select-Object -First 1
      if ($null -eq $selected) { $selected = $candidates[0] }
      $selectedPlayer = [string]$player.id
      break
    }
  }
  # 3) Fall back to the raw app id match.
  if ($null -eq $selected -and $Match) {
    $candidates = @($sessions | Where-Object { $_.SourceAppUserModelId -like "*$Match*" })
    if ($candidates.Count -gt 0) {
      $selected = $candidates | Where-Object { "$($_.GetPlaybackInfo().PlaybackStatus)" -eq 'Playing' } | Select-Object -First 1
      if ($null -eq $selected) { $selected = $candidates[0] }
      $selectedPlayer = 'match'
    }
  }
  # 4) Last resort: any playing session, otherwise the first available session.
  if ($null -eq $selected) {
    $selected = $sessions | Where-Object { "$($_.GetPlaybackInfo().PlaybackStatus)" -eq 'Playing' } | Select-Object -First 1
    if ($null -eq $selected) { $selected = $sessions[0] }
    $selectedPlayer = 'any'
  }

  switch ($Action) {
    'pause' { $ok = Await ($selected.TryPauseAsync()) ([bool]) }
    'resume' { $ok = Await ($selected.TryPlayAsync()) ([bool]) }
    'next' { $ok = Await ($selected.TrySkipNextAsync()) ([bool]) }
    'prev' { $ok = Await ($selected.TrySkipPreviousAsync()) ([bool]) }
  }

  Start-Sleep -Milliseconds 250
  $props = Await ($selected.TryGetMediaPropertiesAsync()) $propsType
  $info = $selected.GetPlaybackInfo()

  Write-Result ([ordered]@{
      ok     = [bool]$ok
      app    = $selected.SourceAppUserModelId
      player = $selectedPlayer
      status = "$($info.PlaybackStatus)"
      title  = $props.Title
      artist = $props.Artist
    })
} catch {
  Write-Result ([ordered]@{ ok = $false; error = "$($_.Exception.Message)" })
}
