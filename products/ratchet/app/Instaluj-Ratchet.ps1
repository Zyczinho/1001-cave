# One-time stable setup; future updates are applied from within the Ratchet UI.
$ErrorActionPreference = 'Stop'
$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$destination = Join-Path $env:LOCALAPPDATA 'Ratchet\app'
if ((Resolve-Path $source).Path.TrimEnd('\') -ieq $destination.TrimEnd('\')) {
  Write-Host 'Ratchet jest juz w stalej lokalizacji.'
} else {
  Write-Host 'Przenosze Ratcheta do:' $destination
  try {
    Invoke-RestMethod -Uri 'http://127.0.0.1:47823/api/action' -Method Post -ContentType 'application/json' -Headers @{'X-Ratchet-Local'='1'} -Body '{"action":"quit","data":{}}' -TimeoutSec 2 | Out-Null
    Start-Sleep -Seconds 7
  } catch {}
  # Close only windows titled exactly 'Ratchet' left by older versions.
  Get-Process -Name msedge -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle -eq 'Ratchet' } |
    ForEach-Object { try { [void]$_.CloseMainWindow() } catch {} }
  Start-Sleep -Milliseconds 500
  New-Item -ItemType Directory -Path $destination -Force | Out-Null
  Copy-Item -Path (Join-Path $source '*') -Destination $destination -Recurse -Force
}
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$shortcut = Join-Path $desktop 'Ratchet.lnk'
$ws = New-Object -ComObject WScript.Shell
$link = $ws.CreateShortcut($shortcut)
$link.TargetPath = 'powershell.exe'
$link.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $destination 'Uruchom-Ratchet-Bez-Electron.ps1') + '"'
$link.WorkingDirectory = $destination
$link.IconLocation = (Join-Path $destination 'assets\ratchet.ico')
$link.Description = 'Ratchet — jeden panel, jedna kuleczka, szybkie aktualizacje'
$link.Save()
# Diagnostic entrypoint survives a dead backend and a missing orb process.
$diagnosticShortcut = Join-Path $desktop 'Ratchet - Diagnostyka.lnk'
$diag = $ws.CreateShortcut($diagnosticShortcut)
$diag.TargetPath = 'powershell.exe'
$diag.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $destination 'Diagnostyka-Ratchet.ps1') + '"'
$diag.WorkingDirectory = $destination
$diag.IconLocation = (Join-Path $destination 'assets\ratchet.ico')
$diag.Description = 'Ratchet - diagnoza jednym kliknieciem, raport tylko lokalnie'
$diag.Save()
Write-Host ('Gotowe. Skrot na Pulpicie: ' + $shortcut)
Write-Host ('Diagnostyka bez serwera: ' + $diagnosticShortcut)
Start-Process powershell.exe -ArgumentList @('-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $destination 'Uruchom-Ratchet-Bez-Electron.ps1')+'"')) -WorkingDirectory $destination
