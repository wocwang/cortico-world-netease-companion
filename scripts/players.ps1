# Parses the JSON player list passed by Node (MUSIC_PLAYER_ORDER or -Priority).
# Windows PowerShell 5.1 does not enumerate a top-level JSON array from ConvertFrom-Json,
# so @($json | ConvertFrom-Json) yields a single Object[] element. Expand it explicitly.
function Read-PlayerList([string]$Json) {
    if (-not $Json) { return }
    $decoded = $Json | ConvertFrom-Json
    foreach ($item in $decoded) { $item }
}
