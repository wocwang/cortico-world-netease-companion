param(
  [Parameter(Mandatory = $true)][ValidateSet('pause', 'resume', 'next', 'prev')][string]$Action,
  [string]$Match = ''
)

$ErrorActionPreference = 'Stop'

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

  $sessions = @($manager.GetSessions())
  if ($Match) {
    $sessions = @($sessions | Where-Object { $_.SourceAppUserModelId -like "*$Match*" })
  }
  if ($sessions.Count -eq 0) {
    Write-Result ([ordered]@{ ok = $false; error = 'No controllable media session' })
    exit 0
  }

  $session = $sessions | Where-Object { "$($_.GetPlaybackInfo().PlaybackStatus)" -eq 'Playing' } | Select-Object -First 1
  if ($null -eq $session) { $session = $sessions[0] }

  switch ($Action) {
    'pause' { $ok = Await ($session.TryPauseAsync()) ([bool]) }
    'resume' { $ok = Await ($session.TryPlayAsync()) ([bool]) }
    'next' { $ok = Await ($session.TrySkipNextAsync()) ([bool]) }
    'prev' { $ok = Await ($session.TrySkipPreviousAsync()) ([bool]) }
  }

  Start-Sleep -Milliseconds 250
  $props = Await ($session.TryGetMediaPropertiesAsync()) $propsType
  $info = $session.GetPlaybackInfo()

  Write-Result ([ordered]@{
      ok     = [bool]$ok
      app    = $session.SourceAppUserModelId
      status = "$($info.PlaybackStatus)"
      title  = $props.Title
      artist = $props.Artist
    })
} catch {
  Write-Result ([ordered]@{ ok = $false; error = "$($_.Exception.Message)" })
}
