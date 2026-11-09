@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Zatrzymaj-Ratchet.ps1"
echo Proces Ratcheta zamkniety (jesli byl uruchomiony).
pause
