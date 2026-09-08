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
    call npm run db:seed
    popd
)
echo       OK
echo.

echo [4/5] Starting backend server...
start "Backend - DO NOT CLOSE" cmd /k "cd /d %~dp0backend && npm run dev"
timeout /t 8 /nobreak >nul

echo [5/5] Starting frontend...
start "Frontend - DO NOT CLOSE" cmd /k "cd /d %~dp0frontend && npm run dev"
timeout /t 8 /nobreak >nul
start http://localhost:5173

color 0A
echo.
echo ================================================================
echo    [OK] System started!
echo    Browser:  http://localhost:5173
echo    Login:    admin / Admin@2026
echo    Do NOT close the two server windows
echo ================================================================
echo.
pause