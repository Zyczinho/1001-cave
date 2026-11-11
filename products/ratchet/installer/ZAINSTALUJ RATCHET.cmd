@echo off
setlocal
chcp 65001 >nul
title Rachet - instalacja
cd /d "%~dp0"
if not exist "%~dp0app\Instaluj-Ratchet.ps1" (
  echo Rozpakuj caly plik ZIP, a potem uruchom ten plik ponownie.
  pause
  exit /b 1
)
echo Instaluje Racheta. To potrwa kilkanascie sekund...
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\Instaluj-Ratchet.ps1"
if errorlevel 1 (
  echo.
  echo Instalacja nie powiodla sie. Szczegoly: %%LOCALAPPDATA%%\Ratchet\install.log
  pause
  exit /b 1
)
exit /b 0
