# Emergency stop. Works even if localhost and the web panel are offline.
$ErrorActionPreference = 'Continue'
try {
  $body = @{action='quit';data=@{}} | ConvertTo-Json -Compress
  Invoke-RestMethod -Uri 'http://127.0.0.1:47823/api/action' -Method Post -ContentType 'application/json' -Headers @{'X-Ratchet-Local'='1'} -Body $body -TimeoutSec 2 | Out-Null
} catch {}
Start-Sleep -Seconds 2
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' OR Name = 'pwsh.exe'" |
  Where-Object {
    $_.ProcessId -ne $PID -and
    $_.CommandLine -match 'Ratchet-Kuleczka[.]ps1|Uruchom-Ratchet-Bez-Electron[.]ps1'
  } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
# Ratchet.exe hosts the orb in-process (0.2.9+); only the copy that sits next to Ratchet's scripts.
Get-CimInstance Win32_Process -Filter "Name = 'Ratchet.exe'" |
  Where-Object {
    $_.ProcessId -ne $PID -and $_.ExecutablePath -and
    (Test-Path -LiteralPath (Join-Path (Split-Path $_.ExecutablePath -Parent) 'Ratchet-Kuleczka.ps1'))
  } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
