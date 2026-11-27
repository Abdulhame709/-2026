@echo off
setlocal
cd /d "%~dp0backend"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\setup-backup-key.ps1"
if errorlevel 1 (
  echo Backup key setup failed. The existing key, if any, was not replaced.
  pause
  exit /b 1
)
echo Backup key setup completed. Restart the backend using the site launcher.
pause
