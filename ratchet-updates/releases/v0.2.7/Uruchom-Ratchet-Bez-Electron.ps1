# Stable launcher: an independent native orb supervising the localhost service.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
. (Join-Path $root 'Ratchet-Backend.ps1')
try {
  $health = Start-RatchetBackend
  if (-not $health) { throw 'Serwer Ratcheta nie odpowiada. Sprawdź logi w %LOCALAPPDATA%\Ratchet\logs.' }
  # The orb owns a named Windows mutex. Repeated launch requests focus the panel.
  # No need to kill the server or the orb from a second launcher.
  $mascot = Join-Path $root 'Ratchet-Kuleczka.ps1'
  & $mascot
} catch {
  $log = Join-Path $env:LOCALAPPDATA 'Ratchet\launcher-error.log'
  New-Item -ItemType Directory -Path (Split-Path $log) -Force | Out-Null
  Add-Content -LiteralPath $log -Value ((Get-Date -Format s) + ' ' + $_.Exception.ToString())
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show(('Nie można uruchomić Ratcheta. Szczegóły: ' + $log),'Ratchet') | Out-Null
  exit 1
}
