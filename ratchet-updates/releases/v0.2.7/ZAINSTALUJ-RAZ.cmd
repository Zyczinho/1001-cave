@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where node.exe >nul 2>&1
if errorlevel 1 (
  echo Nie widze Node.js. Najpierw zainstaluj Node.js LTS.
  pause
  exit /b 1
)
echo Instalacja Ratchet 0.2.7 do stalego folderu Windows...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Instaluj-Ratchet.ps1"
if errorlevel 1 (
  echo Instalacja Ratcheta nie udala sie. Wyslij zrzut tego okna.
  pause
  exit /b 1
)
echo Ratchet jest gotowy. Uzywaj skrotu "Ratchet" na Pulpicie.
pause
