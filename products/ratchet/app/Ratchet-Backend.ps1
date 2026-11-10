# Ratchet backend supervision. Dot-source from the launcher and the native orb.
# One server start at a time, no dependence on an open Terminal window.
$script:ratchetBackendRoot = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($script:ratchetBackendRoot)) { throw 'Cannot resolve Ratchet-Backend.ps1 location' }
# Single PowerShell source of truth for the release number and the local port.
$script:RatchetVersion = '0.2.9'
$script:RatchetPort = 47823
# Tests run a second, isolated Ratchet on another port without touching the user's copy.
if ($env:RATCHET_PORT -match '^[1-9][0-9]{3,4}$') { $script:RatchetPort = [int]$env:RATCHET_PORT }
$script:RatchetBaseUrl = 'http://127.0.0.1:' + $script:RatchetPort
$script:RatchetInstanceSuffix = ''
if ($script:RatchetPort -ne 47823) { $script:RatchetInstanceSuffix = '-' + $script:RatchetPort }
$script:ratchetBackendUrl = $script:RatchetBaseUrl + '/api/ping'

function Get-RatchetBackendHealth {
  try {
    $response = Invoke-RestMethod -Uri $script:ratchetBackendUrl -TimeoutSec 1
    # A server that is shutting down (quit + relaunch within seconds) is not healthy.
    if ($response.ok -and -not $response.quitting) { return $response }
  } catch { }
  return $null
}

# Wait until nothing answers on the port any more (old server finished its shutdown).
function Wait-RatchetBackendReleased {
  for ($i = 0; $i -lt 40; $i++) {
    try { Invoke-RestMethod -Uri $script:ratchetBackendUrl -TimeoutSec 1 | Out-Null } catch { return $true }
    Start-Sleep -Milliseconds 250
  }
  return $false
}

function Invoke-RatchetAction([string]$name, [int]$timeoutSec = 2) {
  $body = '{"action":"' + $name + '","data":{}}'
  Invoke-RestMethod -Uri ($script:RatchetBaseUrl + '/api/action') -Method Post -ContentType 'application/json' -Headers @{'X-Ratchet-Local'='1'} -Body $body -TimeoutSec $timeoutSec | Out-Null
}

function Start-RatchetBackend {
  param([switch]$ForceCheck)
  $existing = Get-RatchetBackendHealth
  if ($existing -and $existing.version -eq $script:RatchetVersion) { return $existing }
  if ($existing -and $existing.version -match '^0\.2\.[0-8]$') {
    try { Invoke-RatchetAction 'quit' 3 } catch {}
    for($i=0;$i -lt 40;$i++){Start-Sleep -Milliseconds 250;if(-not (Get-RatchetBackendHealth)){break}}
  }
  $mutex = [System.Threading.Mutex]::new($false, 'Local\1001CAVE_RatchetBackendStart' + $script:RatchetInstanceSuffix)
  $owned = $false
  try {
    try { $owned = $mutex.WaitOne(2200) }
    catch [System.Threading.AbandonedMutexException] { $owned = $true }
    if (-not $owned) { return $null }
    # Another launcher may have started the server while we waited.
    $existing = Get-RatchetBackendHealth
    if ($existing) { if($existing.version -eq $script:RatchetVersion){return $existing} else{throw ('Port ' + $script:RatchetPort + ' zajmuje inna wersja: '+$existing.version)} }
    if (-not (Wait-RatchetBackendReleased)) { throw ('Port ' + $script:RatchetPort + ' nie zwolnił się po zamknięciu poprzedniego serwera') }
    $node = (Get-Command 'node.exe' -ErrorAction Stop).Source
    $entry = Join-Path $script:ratchetBackendRoot 'server.cjs'
    if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { throw 'Brakuje server.cjs' }
    $logs = Join-Path $env:LOCALAPPDATA 'Ratchet\logs'
    New-Item -ItemType Directory -Path $logs -Force | Out-Null
    # Old start logs are tiny but accumulate on every restart: keep the newest 20 pairs.
    try {
      Get-ChildItem -LiteralPath $logs -Filter '*-out.log' -File | Sort-Object LastWriteTime -Descending | Select-Object -Skip 20 |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue; Remove-Item -LiteralPath ($_.FullName -replace '-out\.log$','-error.log') -Force -ErrorAction SilentlyContinue }
    } catch {}
    # Distinct names avoid file-handle conflicts when a previous process crashed.
    $stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-ffff')
    Start-Process -FilePath $node -ArgumentList ('"' + $entry + '"') -WorkingDirectory $script:ratchetBackendRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs "$stamp-out.log") -RedirectStandardError (Join-Path $logs "$stamp-error.log") | Out-Null
    for ($i=0; $i -lt 24; $i++) {
      Start-Sleep -Milliseconds 250
      $health = Get-RatchetBackendHealth
      if ($health) { return $health }
    }
  } finally {
    if ($owned) { try { $mutex.ReleaseMutex() } catch {} }
    $mutex.Dispose()
  }
  return $null
}
