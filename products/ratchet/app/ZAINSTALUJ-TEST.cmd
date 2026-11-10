@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where node.exe >nul 2>&1
if errorlevel 1 (
  echo Brakuje Node.js. Instalacja testowa nie moze byc uruchomiona.
  pause
  exit /b 1
)
if not exist "%~dp0ratchet-release-manifest.json" (
  echo Brak manifestu. Najpierw rozpakuj caly plik ZIP do osobnego folderu.
  pause
  exit /b 1
)
echo Ratchet 0.2.8 RC - instalacja testowa z kopia poprzedniej wersji
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Instaluj-Ratchet-Test.ps1"
if errorlevel 1 (
  echo Nie udalo sie zainstalowac wersji testowej. Sprawdz dziennik wskazany powyzej.
  pause
  exit /b 1
)
echo Gotowe. Kliknij skrot Ratchet na pulpicie, aby otworzyc kuleczke.
pause
exit /b 0
