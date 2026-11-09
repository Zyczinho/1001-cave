# One-click launcher for Ratchet 0.2.4
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$log = Join-Path $root 'Ratchet-serwer.log'
try {
  $node = (Get-Command 'node.exe' -ErrorAction Stop).Source
  $alive = $false
  $ping = $null
  try { $ping=Invoke-RestMethod 'http://127.0.0.1:47823/api/ping' -TimeoutSec 2; $alive=[bool]$ping.ok } catch {}
  if($alive -and $ping.version -ne '0.2.4') {
    Write-Host 'Wykryto starszego Ratcheta. Zamykam go przed aktualizacja...'
    try {
      Invoke-RestMethod -Uri 'http://127.0.0.1:47823/api/action' -Method Post -ContentType 'application/json' -Headers @{'X-Ratchet-Local'='1'} -Body '{"action":"quit","data":{}}' -TimeoutSec 3 | Out-Null
    } catch { throw 'Nie udalo sie zatrzymac starszego Ratcheta. Zamknij go przed aktualizacja.' }
    # Stop only processes launched from Ratchet's previous PowerShell launcher.
    try {
      Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' OR Name = 'pwsh.exe'" | Where-Object {
        $_.ProcessId -ne $PID -and $_.CommandLine -match '(?i)(Uruchom-Ratchet-Bez-Electron|Ratchet-Kuleczka)\.ps1'
      } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    } catch {}
    $alive = $false
    for($i=0;$i -lt 35;$i++) {
      Start-Sleep -Milliseconds 250
      try {$p=Invoke-RestMethod 'http://127.0.0.1:47823/api/ping' -TimeoutSec 1; if($p.ok){$alive=$true}else{break}} catch {$alive=$false;break}
    }
    if($alive){throw 'Stara wersja nadal zajmuje port 47823. Zamknij Ratcheta i uruchom ponownie.'}
  }
  if(-not $alive) {
    $server = Join-Path $root 'server.cjs'
    $errLog= Join-Path $root 'Ratchet-serwer-error.log'
    Start-Process -FilePath $node -ArgumentList ('"' + $server + '"') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $errLog | Out-Null
    $started = $false
    for($i=0;$i -lt 20;$i++) {
       Start-Sleep -Milliseconds 350
       try { $ping = Invoke-RestMethod 'http://127.0.0.1:47823/api/ping' -TimeoutSec 1; if($ping.ok){$started=$true;break} } catch {}
    }
    if(-not $started) {throw "Nie udało się uruchomić serwera. Sprawdź $log i $errLog"}
  }
  if($alive) {
    # Ask the already-running mascot to bring the existing panel to the front.
    try { Invoke-RestMethod -Uri 'http://127.0.0.1:47823/api/action' -Method Post -ContentType 'application/json' -Headers @{'X-Ratchet-Local'='1'} -Body '{"action":"panel:show","data":{}}' -TimeoutSec 2 | Out-Null } catch {}
  }
  $mascot = Join-Path $root 'Ratchet-Kuleczka.ps1'
  # Show PowerShell errors if the orb fails; server/UI can still be opened from the URL below.
  & $mascot
} catch {
  Write-Host ('Ratchet: ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host 'Jesli kuleczka nie wystartuje, otworz w Edge: http://127.0.0.1:47823/ui/panel.html'
  Read-Host 'Wcisnij Enter aby zamknac'
  exit 1
}
