# Ratchet backend supervision. Dot-source from the launcher and the native orb.
# One server start at a time, no dependence on an open Terminal window.
$script:ratchetBackendRoot = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($script:ratchetBackendRoot)) { throw 'Cannot resolve Ratchet-Backend.ps1 location' }
$script:ratchetBackendUrl = 'http://127.0.0.1:47823/api/ping'

function Get-RatchetBackendHealth {
  try {
    $response = Invoke-RestMethod -Uri $script:ratchetBackendUrl -TimeoutSec 1
    if ($response.ok) { return $response }
  } catch { }
  return $null
}

function Start-RatchetBackend {
  param([switch]$ForceCheck)
  $existing = Get-RatchetBackendHealth
  if ($existing -and $existing.version -eq '0.2.7') { return $existing }
  if ($existing -and $existing.version -match '^0\.2\.[0-6]$') {
    try {Invoke-RestMethod -Uri 'http://127.0.0.1:47823/api/action' -Method Post -ContentType 'application/json' -Headers @{'X-Ratchet-Local'='1'} -Body '{"action":"quit","data":{}}' -TimeoutSec 3 | Out-Null} catch {}
    for($i=0;$i -lt 28;$i++){Start-Sleep -Milliseconds 250;if(-not (Get-RatchetBackendHealth)){break}}
  }
  $mutex = [System.Threading.Mutex]::new($false, 'Local\1001CAVE_RatchetBackendStart')
  $owned = $false
  try {
    try { $owned = $mutex.WaitOne(2200) }
    catch [System.Threading.AbandonedMutexException] { $owned = $true }
    if (-not $owned) { return $null }
    # Another launcher may have started the server while we waited.
    $existing = Get-RatchetBackendHealth
    if ($existing) { if($existing.version -eq '0.2.7'){return $existing} else{throw ('Port 47823 zajmuje inna wersja: '+$existing.version)} }
    $node = (Get-Command 'node.exe' -ErrorAction Stop).Source
    $entry = Join-Path $script:ratchetBackendRoot 'server.cjs'
    if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { throw 'Brakuje server.cjs' }
    $logs = Join-Path $env:LOCALAPPDATA 'Ratchet\logs'
    New-Item -ItemType Directory -Path $logs -Force | Out-Null
    # Distinct names avoid file-handle conflicts when a previous process crashed.
    $stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-ffff')
    Start-Process -FilePath $node -ArgumentList ('"' + $entry + '"') -WorkingDirectory $script:ratchetBackendRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs "$stamp-out.log") -RedirectStandardError (Join-Path $logs "$stamp-error.log") | Out-Null
    for ($i=0; $i -lt 16; $i++) {
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
