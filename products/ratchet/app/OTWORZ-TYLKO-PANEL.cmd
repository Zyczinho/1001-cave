@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node.exe >nul 2>&1
if errorlevel 1 (echo Brak Node.js & pause & exit /b 1)
start "Ratchet server" /min cmd /c "node server.cjs 1>Ratchet-serwer.log 2>Ratchet-serwer-error.log"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:47823/ui/panel.html"
