# Stable launcher: an independent native orb supervising the localhost service.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$log = Join-Path $env:LOCALAPPDATA 'Ratchet\launcher-boot.log'
try {
  New-Item -ItemType Directory -Path (Split-Path $log) -Force | Out-Null
  Add-Content -LiteralPath $log -Value ('['+(Get-Date -Format s)+'] BEGIN '+$root)
  if ([string]::IsNullOrWhiteSpace($root)) { throw 'Nie rozpoznano katalogu Ratcheta' }
  Set-Location -LiteralPath $root
  . (Join-Path $root 'Ratchet-Backend.ps1')
  Add-Content -LiteralPath $log -Value ('['+(Get-Date -Format s)+'] BACKEND_SOURCE_OK')
  $health = Start-RatchetBackend
  if (-not $health -or -not $health.ok) { throw 'Serwer Ratcheta nie odpowiada. Sprawdź logi w %LOCALAPPDATA%\Ratchet\logs.' }
  Add-Content -LiteralPath $log -Value ('['+(Get-Date -Format s)+'] BACKEND_OK '+$health.version)
  $mascot = Join-Path $root 'Ratchet-Kuleczka.ps1'
  & $mascot
} catch {
  $errorText = '['+(Get-Date -Format s)+'] ERROR '+$_.Exception.ToString()
  try { Add-Content -LiteralPath $log -Value $errorText } catch {}
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(('Ratchet: nie można uruchomić aplikacji. Log: '+$log),'Ratchet') | Out-Null
  } catch {}
  exit 1
}
