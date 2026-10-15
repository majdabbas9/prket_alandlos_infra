# Prints the backend containers' own log lines (pino output) from Cloudflare Workers Observability.
# `wrangler tail` can't show these - it only sees the Worker.
#
#   .\logs.ps1                  # last 30 min, both containers
#   .\logs.ps1 -Minutes 120     # further back
#   .\logs.ps1 -Search redis    # only lines containing "redis"
#   .\logs.ps1 -All             # include the Worker's own events too
#
# Needs an API token with Account > Workers Observability > Read in CLAUDE_CODE_CLOUDFLARE_TOKEN_DEV.
param(
  [int]$Minutes = 30,
  [string]$Search,
  [switch]$All
)

$account = 'bdea2f34b203a609c98be2413d4f8aaa'
$names = @{
  'a03194ce-863b-466d-a99f-9f59f25ff969' = 'backend'
  'a03f5eac-9564-4aa6-9d93-3db83884e9d8' = 'admin'
  'prket-alandlos-api'                   = 'worker'
}

$token = $env:CLAUDE_CODE_CLOUDFLARE_TOKEN_DEV
if (-not $token) { $token = [Environment]::GetEnvironmentVariable('CLAUDE_CODE_CLOUDFLARE_TOKEN_DEV', 'User') }
if (-not $token) { throw 'Set CLAUDE_CODE_CLOUDFLARE_TOKEN_DEV to a token with Workers Observability Read.' }

$now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$body = @{
  queryId    = 'logs-ps1'
  timeframe  = @{ from = $now - $Minutes * 60000; to = $now }
  view       = 'events'
  limit      = 2000
  parameters = @{}
} | ConvertTo-Json -Depth 5

$r = Invoke-RestMethod -Method Post `
  -Uri "https://api.cloudflare.com/client/v4/accounts/$account/workers/observability/telemetry/query" `
  -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body $body

# Container output reaches Cloudflare in batches, so its `timestamp` is the batch's arrival
# time (up to ~1.5s late, many lines identical). Use pino's own `time` when there is one.
$events = $r.result.events.events | Where-Object { $All -or $_.dataset -eq 'containers' } |
  ForEach-Object { $_ | Add-Member -NotePropertyName at -NotePropertyValue ($(if ($_.source.time) { $_.source.time } else { $_.timestamp })) -PassThru } |
  Sort-Object at
if ($Search) { $events = $events | Where-Object { $_.'$metadata'.message -match [regex]::Escape($Search) } }
if (-not $events) { "No container logs in the last $Minutes min. The containers sleep after 15 min idle - open the site, then rerun."; return }

foreach ($e in $events) {
  $m = $e.'$metadata'
  $who = $names[$m.service]; if (-not $who) { $who = $m.service.Substring(0, 8) }
  # pino levels: 50 = error, 40 = warn (Cloudflare marks all container output as "info")
  $lvl = switch ($e.source.level) { 60 { 'FATAL' } 50 { 'ERROR' } 40 { 'WARN ' } default { 'info ' } }
  $line = '{0} {1,-7} {2} {3}' -f [DateTimeOffset]::FromUnixTimeMilliseconds($e.at).LocalDateTime.ToString('HH:mm:ss.fff'), $who, $lvl, $m.message
  if ($m.error) { $line += "  ($($m.error))" }
  $color = switch ($lvl.Trim()) { 'ERROR' { 'Red' } 'FATAL' { 'Red' } 'WARN' { 'Yellow' } default { 'Gray' } }
  Write-Host $line -ForegroundColor $color
}
