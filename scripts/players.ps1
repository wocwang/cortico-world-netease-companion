# Parses the JSON player list passed by Node (MUSIC_PLAYER_ORDER or -Priority).
# Windows PowerShell 5.1 does not enumerate a top-level JSON array from ConvertFrom-Json,
# so @($json | ConvertFrom-Json) yields a single Object[] element. Expand it explicitly.
function Read-PlayerList([string]$Json) {
    if (-not $Json) { return }
    $decoded = $Json | ConvertFrom-Json
    foreach ($item in $decoded) { $item }
}

# Exact app id match, tolerating an optional .exe suffix on either side.
# Never use -like here: AUMIDs from packaged apps can contain [ * ? and would
# be treated as wildcards, silently matching the wrong session.
function Test-AppIdMatch([string]$Id, [string]$Want) {
    if ([string]::IsNullOrEmpty($Id) -or [string]::IsNullOrEmpty($Want)) { return $false }
    $id = $Id.Trim()
    $want = $Want.Trim()
    if ($id -eq $want) { return $true }
    if ($id -eq "$want.exe") { return $true }
    if ("$id.exe" -eq $want) { return $true }
    return $false
}
