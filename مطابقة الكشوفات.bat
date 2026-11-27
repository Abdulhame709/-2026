@echo off
title Reconciliation System Launcher
color 0B
setlocal EnableDelayedExpansion

cd /d "%~dp0"
echo ================================================================
echo    Supplier Statement Reconciliation - One Click Launcher
echo ================================================================
echo.

where node >nul 2>&1 || (color 0C & echo [X] Node.js not found - install from nodejs.org & pause & exit /b 1)
where psql >nul 2>&1 || (color 0C & echo [X] PostgreSQL psql not found in PATH & pause & exit /b 1)

echo [1/5] Checking libraries...
if not exist "backend\node_modules" (
    echo       Installing backend packages - few minutes...
    pushd backend
    call npm install
    if !errorlevel! neq 0 (
        color 0C
        echo  [X] backend npm install failed - check internet
        pause
        popd
        exit /b 1
    )
    popd
)
if not exist "frontend\node_modules" (
    echo       Installing frontend packages - few minutes...
    pushd frontend
    call npm install
    if !errorlevel! neq 0 (
        color 0C
        echo  [X] frontend npm install failed - check internet
        pause
        popd
        exit /b 1
    )
    popd
)
echo       OK
echo.

echo [2/5] Checking PostgreSQL service...
pg_isready -h 127.0.0.1 -p 5432 >nul 2>&1
if !errorlevel! neq 0 (
    echo       Service is down - trying to start...
    net start postgresql-x64-16 2>nul
    net start postgresql-x64-17 2>nul
    net start postgresql-x64-18 2>nul
    timeout /t 4 /nobreak >nul
)
pg_isready -h 127.0.0.1 -p 5432 >nul 2>&1
if !errorlevel! neq 0 (
    color 0C
    echo  [X] Cannot start PostgreSQL service.
    echo      If you saw Access Denied: right-click this file and Run as administrator
    echo      Or start it manually: Win+R then services.msc then postgresql then Start
    pause
    exit /b 1
)
echo       OK
echo.

echo [3/5] Checking database "reconciliation"...
psql -U postgres -d reconciliation -c "SELECT 1;" >nul 2>&1
if !errorlevel! neq 0 (
    if /I not "!NODE_ENV!"=="development" (
        echo  [X] Set NODE_ENV=development before development database setup
        pause
        exit /b 1
    )
    if not defined SEED_ADMIN_PASSWORD (
        echo  [X] Set SEED_ADMIN_PASSWORD, SEED_RECONCILER_PASSWORD and SEED_VIEWER_PASSWORD first
        pause
        exit /b 1
    )
    if not defined SEED_RECONCILER_PASSWORD exit /b 1
    if not defined SEED_VIEWER_PASSWORD exit /b 1
    echo       Database missing - creating and seeding...
    psql -U postgres -c "CREATE DATABASE reconciliation;" >nul 2>&1
    if !errorlevel! neq 0 (
        color 0C
        echo  [X] Could not create database - check postgres password PGPASSWORD
        pause
        exit /b 1
    )
    pushd backend
    call npm run db:migrate
    if !errorlevel! neq 0 exit /b 1
    call npm run db:seed
    if !errorlevel! neq 0 exit /b 1
    popd
)
echo       OK
echo.

echo [4/5] Starting backend server...
if exist "%LOCALAPPDATA%\Mushabaka\backup-key.dpapi" (
    start "Backend - DO NOT CLOSE" cmd /k "cd /d %~dp0backend && powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\start-with-backup-key.ps1"
) else (
    echo       Backup key is not configured - encrypted backups are unavailable
    start "Backend - DO NOT CLOSE" cmd /k "cd /d %~dp0backend && npm run dev"
)
timeout /t 8 /nobreak >nul

echo [5/5] Starting frontend...
start "Frontend - DO NOT CLOSE" cmd /k "cd /d %~dp0frontend && npm run dev"
timeout /t 8 /nobreak >nul
start http://127.0.0.1:5173

color 0A
echo.
echo ================================================================
echo    [OK] System started!
echo    Browser:  http://127.0.0.1:5173
echo    Login:    admin / the password supplied for setup
echo    Do NOT close the two server windows
echo ================================================================
echo.
pause
