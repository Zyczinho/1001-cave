# Ratchet 0.2.7 - one-time recovery for a broken 0.2.4 updater.
# Stable installation location only; all downloads are from owner's private GitHub repo.
# No elevation, no arbitrary commands from manifests, verified SHA256, backup + rollback.
$ErrorActionPreference = 'Stop'
$version = '0.2.7'
$app = Join-Path $env:LOCALAPPDATA 'Ratchet\app'
$repo = 'Zyczinho/1001-cave'
$branch = 'ratchet-updates'
$prefix = 'ratchet-updates/releases/v0.2.7'
$healthUri = 'http://127.0.0.1:47823/api/ping'
$actionUri = 'http://127.0.0.1:47823/api/action'
$dir = Join-Path $env:LOCALAPPDATA 'Ratchet'
$logs = Join-Path $dir 'logs'
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$log = Join-Path $logs 'recover-027.log'
$staging = Join-Path $env:TEMP ('ratchet-recover-' + [guid]::NewGuid().ToString('N'))
$backup = Join-Path $dir ('backup-before-027-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$entries = @()
$startedCopy = $false
$previous = ''
function Trace([string]$message) {
  $line = '[' + (Get-Date -Format s) + '] ' + $message
  Add-Content -LiteralPath $log -Value $line
  Write-Host $message
}
function Ping {
  try { return Invoke-RestMethod -Uri $healthUri -TimeoutSec 2 }
  catch { return $null }
}
function GhDownload([string]$url, [string]$destination) {
  # GitHub Contents API returns base64. Use the same CLI invocation that works
  # in the user's PowerShell; do not guess authentication problems.
  $gh = (Get-Command gh.exe -ErrorAction Stop).Source
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = @(& $gh api -H 'Accept: application/vnd.github+json' --jq '.content' $url 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
  if ($exitCode -ne 0) {
    $details = ($output | ForEach-Object { [string]$_ }) -join ' | '
    throw ('GitHub download failed for ' + $url + ' (exit ' + $exitCode + '): ' + $details)
  }
  $encoded = (($output | ForEach-Object { [string]$_ }) -join '') -replace '\s', ''
  if ($encoded -notmatch '^[A-Za-z0-9+/=]+$' -or $encoded.Length -gt 6000000) {
    throw ('GitHub returned invalid base64 content for ' + $url)
  }
  try {
    $bytes = [Convert]::FromBase64String($encoded)
    [IO.File]::WriteAllBytes($destination, $bytes)
  } catch {
    throw ('Could not decode GitHub file ' + $url + ': ' + $_.Exception.Message)
  }
}

function Stop-Orb {
  # Only Ratchet launchers/mascots. Do not kill other PowerShell windows.
  try {
    Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' OR Name = 'pwsh.exe'" |
      Where-Object {
        $_.ProcessId -ne $PID -and
        $_.CommandLine -match '(?i)(Ratchet-Kuleczka|Uruchom-Ratchet-Bez-Electron)\.ps1' -and
        $_.CommandLine -match '(?i)Ratchet'
      } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  } catch { Trace ('Orb cleanup: ' + $_.Exception.Message) }
}
function Stop-Server {
  $status = Ping
  if (-not $status) { return }
  try {
    $headers = @{'X-Ratchet-Local' = '1'}
    Invoke-RestMethod -Uri $actionUri -Method Post -ContentType 'application/json' -Headers $headers -Body '{"action":"quit","data":{}}' -TimeoutSec 3 | Out-Null
  } catch { Trace 'Old server quit request did not finish; checking port.' }
  for ($i = 0; $i -lt 40; $i++) {
    if (-not (Ping)) { return }
    Start-Sleep -Milliseconds 350
  }
  throw 'Old Ratchet server still runs. Do not modify files while it is active.'
}
function Start-New {
  $launcher = Join-Path $app 'Uruchom-Ratchet-Bez-Electron.ps1'
  if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'Missing launcher' }
  Start-Process -FilePath 'powershell.exe' -WorkingDirectory $app -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $launcher + '"')) | Out-Null
}
function Wait-Version([string]$v, [int]$tries) {
  for ($i = 0; $i -lt $tries; $i++) {
    $result = Ping
    if ($result -and $result.ok -and $result.version -eq $v) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}
try {
  if (-not (Test-Path -LiteralPath (Join-Path $app 'server.cjs') -PathType Leaf)) { throw 'Ratchet installation not found in %LOCALAPPDATA%\Ratchet\app' }
  $status = Ping
  if ($status -and $status.version -eq $version) {
    Trace 'Ratchet 0.2.7 is already running. No repair needed.'
    return
  }
  if (-not (Get-Command gh.exe -ErrorAction SilentlyContinue)) { throw 'GitHub CLI missing. Install gh and sign in using gh auth login.' }
  New-Item -ItemType Directory -Path $staging -Force | Out-Null
  Trace 'Downloading verified Ratchet 0.2.7 files...'
  $manifestFile = Join-Path $staging 'manifest.json'
  GhDownload "repos/$repo/contents/$prefix/manifest.json?ref=$branch" $manifestFile
  $manifest = Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($manifest.version -ne $version -or @($manifest.files).Count -lt 10 -or @($manifest.files).Count -gt 60) { throw 'Invalid pinned release manifest' }
  $seen = New-Object 'System.Collections.Generic.HashSet[string]'
  foreach ($f in $manifest.files) {
    $name = [string]$f.path
    $digest = [string]$f.sha256
    if ($name -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._/-]*\.(cmd|ps1|cjs|js|html|css|json|md|txt|png)$' -or
        $name.Contains('..') -or $name.Contains('\') -or
        $digest -notmatch '^[a-fA-F0-9]{64}$' -or -not $seen.Add($name)) { throw 'Unsafe release file: ' + $name }
    $dest = Join-Path $staging $name
    New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
    $urlPath = ($name -split '/' | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/'
    GhDownload "repos/$repo/contents/$prefix/$urlPath?ref=$branch" $dest
    $actual = (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash
    if ($actual -ine $digest) { throw 'SHA256 mismatch for ' + $name }
  }
  Trace ('All ' + $seen.Count + ' files downloaded and verified.')
  # Back up installed files before any modification; user data is outside app dir.
  New-Item -ItemType Directory -Path $backup -Force | Out-Null
  foreach ($name in $seen) {
    $orig = Join-Path $app $name
    $exists = Test-Path -LiteralPath $orig -PathType Leaf
    $entries += [pscustomobject]@{ Path=$name; Existed=$exists }
    if ($exists) {
      $bak = Join-Path $backup $name
      New-Item -ItemType Directory -Path (Split-Path -Parent $bak) -Force | Out-Null
      Copy-Item -LiteralPath $orig -Destination $bak -Force
    }
  }
  $current = Ping
  if ($current) { $previous = [string]$current.version }
  Trace 'Stopping only Ratchet orb and local server...'
  Stop-Orb
  Stop-Server
  $startedCopy = $true
  foreach ($item in $entries) {
    $dst = Join-Path $app $item.Path
    New-Item -ItemType Directory -Path (Split-Path -Parent $dst) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $staging $item.Path) -Destination $dst -Force
  }
  Trace 'Starting Ratchet 0.2.7...'
  Start-New
  if (-not (Wait-Version $version 48)) { throw 'New server failed /api/ping smoke test' }
  Trace 'SUCCESS: Ratchet 0.2.7 is responding; you may close the old Terminal.'
  Trace ('Backup is available at: ' + $backup)
} catch {
  Trace ('FAILED: ' + $_.Exception.Message)
  if ($startedCopy) {
    try {
      Stop-Orb
      try { Stop-Server } catch {}
      foreach ($item in $entries) {
        $dst = Join-Path $app $item.Path
        if ($item.Existed) {
          $bak = Join-Path $backup $item.Path
          if (Test-Path -LiteralPath $bak -PathType Leaf) {
            Copy-Item -LiteralPath $bak -Destination $dst -Force
          }
        } elseif (Test-Path -LiteralPath $dst) {
          Remove-Item -LiteralPath $dst -Force
        }
      }
      Trace 'Rollback restored previous application files.'
      Start-New
      if ($previous) { Wait-Version $previous 20 | Out-Null }
    } catch { Trace ('Rollback error: ' + $_.Exception.Message) }
  }
  Trace ('Log: ' + $log)
} finally {
  if (Test-Path -LiteralPath $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
  }
}
