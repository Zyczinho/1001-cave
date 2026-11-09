@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if not exist "%~dp0Ratchet-Backend.ps1" (
  echo Brakuje plikow Ratcheta. Rozpakuj cala aplikacje.
  pause
  exit /b 1
)
where node.exe >nul 2>&1
if errorlevel 1 (
  echo Brak Node.js w PATH. Zainstaluj Node.js LTS.
  pause
  exit /b 1
)
rem Detached process: closing this CMD window does not stop Ratchet.
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -WorkingDirectory '%~dp0' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0Uruchom-Ratchet-Bez-Electron.ps1')"
exit /b %ERRORLEVEL%
