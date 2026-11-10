@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if not exist "%~dp0Diagnostyka-Ratchet.ps1" (
  echo Brak pliku diagnostycznego Ratcheta.
  exit /b 1
)
rem One command collects a local-only report even if Node, orb or localhost is down.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Diagnostyka-Ratchet.ps1"
if errorlevel 1 (
  echo Diagnostyka nie mogla zakonczyc pracy. Sprawdz folder %%LOCALAPPDATA%%\Ratchet\diagnostics.
  exit /b 1
)
exit /b 0
