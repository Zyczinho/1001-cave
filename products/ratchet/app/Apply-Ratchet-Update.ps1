# Executed OUTSIDE the running server, after all incoming files are SHA-256 checked.
# Applies a verified update with snapshot/rollback and a mandatory localhost smoke test.
param(
  [Parameter(Mandatory=$true)][string]$AppRoot,
  [Parameter(Mandatory=$true)][string]$Staging,
  [Parameter(Mandatory=$true)][int]$ServerProcessId,
  [Parameter(Mandatory=$true)][string]$ExpectedVersion
)
$ErrorActionPreference='Stop'
$log=Join-Path $env:LOCALAPPDATA 'Ratchet\update-log.txt'
New-Item -ItemType Directory -Path (Split-Path $log) -Force | Out-Null
function Trace([string]$message) { Add-Content -LiteralPath $log -Value ('['+(Get-Date -Format s)+'] '+$message) }
function Ping {
  try {return Invoke-RestMethod 'http://127.0.0.1:47823/api/ping' -TimeoutSec 1}
  catch{return $null}
}
function Launch {
  $launcher=Join-Path $AppRoot 'Uruchom-Ratchet-Bez-Electron.ps1'
  if(-not (Test-Path -LiteralPath $launcher -PathType Leaf)){throw 'Brakuje launchera Ratcheta'}
  Start-Process -FilePath 'powershell.exe' -WorkingDirectory $AppRoot -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$launcher+'"')) | Out-Null
}
function WaitForVersion([string]$version,[int]$tries=48) {
  for($i=0;$i -lt $tries;$i++){
    Start-Sleep -Milliseconds 500
    $health=Ping
    if($health -and $health.ok -and $health.version -eq $version){return $true}
  }
  return $false
}
function StopRunningServer {
  $health=Ping
  if($health -and $health.ok){
    try { Invoke-RestMethod -Uri 'http://127.0.0.1:47823/api/action' -Method Post -ContentType 'application/json' -Headers @{'X-Ratchet-Local'='1'} -Body '{"action":"quit","data":{}}' -TimeoutSec 2 | Out-Null } catch {}
    for($i=0;$i -lt 24;$i++){Start-Sleep -Milliseconds 250;if(-not (Ping)){break}}
  }
}
$backup=Join-Path $env:LOCALAPPDATA ('Ratchet\backup-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
$items=@()
$copied=$false
$oldVersion=''
try {
  if($ExpectedVersion -notmatch '^\d+\.\d+\.\d+$'){throw 'Niepoprawny numer wersji'}
  $AppRoot=[IO.Path]::GetFullPath($AppRoot)
  $Staging=[IO.Path]::GetFullPath($Staging)
  # Do not trust target directories outside this user's Ratchet installation.
  $expectedRoot=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Ratchet\app'))
  if($AppRoot.TrimEnd('\') -ine $expectedRoot.TrimEnd('\')){throw 'Niebezpieczny folder instalacji'}
  $listFile=Join-Path $Staging 'ratchet-update-list.json'
  $fileList=@(Get-Content -LiteralPath $listFile -Raw | ConvertFrom-Json)
  if($fileList.Count -eq 0 -or $fileList.Count -gt 100){throw 'Niepoprawna lista plików'}
  $current=Ping
  if($current){$oldVersion=[string]$current.version}
  Trace "Starting update $oldVersion -> $ExpectedVersion"
  for($i=0;$i -lt 72;$i++) {
    if(-not (Get-Process -Id $ServerProcessId -ErrorAction SilentlyContinue)){break}
    Start-Sleep -Milliseconds 250
  }
  if(Get-Process -Id $ServerProcessId -ErrorAction SilentlyContinue){throw 'Stary serwer nie zakończył pracy'}
  New-Item -ItemType Directory -Path $backup -Force | Out-Null
  foreach($relative in $fileList){
    if($relative -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._/-]*\.(cmd|ps1|cjs|js|html|css|json|md|txt|png|ico)$' -or $relative.Contains('..') -or $relative.Contains('\')) {throw 'Niebezpieczna ścieżka aktualizacji'}
    $src=Join-Path $Staging $relative
    $dst=Join-Path $AppRoot $relative
    if(!(Test-Path -LiteralPath $src -PathType Leaf)){throw "Brak pliku $relative"}
    $wasThere=Test-Path -LiteralPath $dst -PathType Leaf
    if($wasThere){
      $original=Join-Path $backup $relative
      New-Item -ItemType Directory -Path (Split-Path $original) -Force | Out-Null
      Copy-Item -LiteralPath $dst -Destination $original -Force
    }
    $items+= [pscustomobject]@{Relative=$relative; Existed=$wasThere}
  }
  foreach($item in $items){
    $dst=Join-Path $AppRoot $item.Relative
    New-Item -ItemType Directory -Path (Split-Path $dst) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $Staging $item.Relative) -Destination $dst -Force
  }
  $copied=$true
  Trace "Copied $($items.Count) verified files; starting smoke test"
  Launch
  if(-not (WaitForVersion $ExpectedVersion 48)){throw "Nowa wersja $ExpectedVersion nie odpowiada na /api/ping"}
  Trace "SUCCESS ${ExpectedVersion}: /api/ping confirmed"
  Remove-Item -LiteralPath $Staging -Recurse -Force -ErrorAction SilentlyContinue
  exit 0
} catch {
  Trace ('FAILED: '+$_.Exception.Message)
  # Rollback every copied file, including files that did not exist before.
  if($items.Count -gt 0){
    StopRunningServer
    foreach($item in $items){
      $dst=Join-Path $AppRoot $item.Relative
      if($item.Existed){
        $previous=Join-Path $backup $item.Relative
        if(Test-Path -LiteralPath $previous -PathType Leaf){Copy-Item -LiteralPath $previous -Destination $dst -Force}
      } elseif(Test-Path -LiteralPath $dst){Remove-Item -LiteralPath $dst -Force}
    }
    Trace 'Rollback files restored'
    try {
      Launch
      if($oldVersion -and (WaitForVersion $oldVersion 35)){Trace "Rollback server $oldVersion responding"}
      else{Trace 'Rollback restart requires manual verification'}
    } catch {Trace ('Rollback launch failed: '+$_.Exception.Message)}
  }
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(('Aktualizacja Ratcheta nie powiodła się. Przywrócono poprzednie pliki. Szczegóły: '+$log),'Ratchet — aktualizacja') | Out-Null
  } catch {}
  exit 1
}
