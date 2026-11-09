@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
echo RATCHeT 0.2.1 - DIAGNOSTYKA BEZ ELECTRON
echo Folder: %CD%
echo.
if exist server.cjs (echo server.cjs: OK) else (echo server.cjs: BRAK)
if exist Ratchet-Kuleczka.ps1 (echo Ratchet-Kuleczka.ps1: OK) else (echo Ratchet-Kuleczka.ps1: BRAK)
if exist ui\panel.html (echo ui\panel.html: OK) else (echo ui\panel.html: BRAK)
echo.
where node.exe
node --version
echo.
powershell.exe -NoProfile -Command "try { Invoke-RestMethod -Uri 'http://127.0.0.1:47823/api/ping' -TimeoutSec 3 | ConvertTo-Json } catch { Write-Host 'Serwer nie odpowiada:' $_.Exception.Message }"
echo.
if exist Ratchet-serwer-error.log (powershell.exe -NoProfile -Command "Get-Content -LiteralPath '.\Ratchet-serwer-error.log' -Tail 20") else (echo Brak logu bledow serwera)
echo.
pause
