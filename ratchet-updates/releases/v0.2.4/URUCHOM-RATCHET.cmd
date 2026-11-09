@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if not exist "%~dp0server.cjs" (
  echo BLAD: Brakuje plikow Ratcheta. Wybierz Wyodrebnij wszystkie i uruchom z rozpakowanego folderu.
  pause
  exit /b 1
)
where node.exe >nul 2>&1
if errorlevel 1 (
  echo Brak Node.js. Na tym komputerze byl wczesniej Node.js v26, ale ten skrypt go teraz nie widzi.
  echo Zainstaluj Node.js LTS lub otworz nowe okno terminala.
  pause
  exit /b 1
)
echo Ratchet 0.2.4 - start bez Electron i bez npm install.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Uruchom-Ratchet-Bez-Electron.ps1"
if errorlevel 1 pause
