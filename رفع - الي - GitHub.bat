@echo off
title Reconciliation - Push to GitHub
color 0B
setlocal EnableDelayedExpansion

cd /d "%~dp0"

echo ================================================================
echo    Supplier Reconciliation - Push updates to GitHub
echo ================================================================
echo.

:: ---- 0) Git identity (first run only) ----
git config user.name >nul 2>&1
if !errorlevel! neq 0 (
    set /p GITNAME=Enter your name for Git (any text^):
    git config --global user.name "!GITNAME!"
)
git config user.email >nul 2>&1
if !errorlevel! neq 0 (
    set /p GITEMAIL=Enter your email for Git (any text^):
    git config --global user.email "!GITEMAIL!"
)

:: ---- 1) status before ----
echo [1/5] Current status:
echo.
git status -s
echo.
echo (files above = what changed locally)
echo.

:: ---- 2) stage everything ----
echo [2/5] Staging all changes...
git add -A
echo       OK
echo.

:: ---- 3) commit ----
echo [3/5] Committing...
git commit -m "Local updates from my machine" >nul 2>&1
if !errorlevel! equ 0 (
    echo       Committed.
) else (
    echo       Nothing new to commit - working tree already clean.
)
echo.

:: ---- 4) push ----
echo [4/5] Pushing to GitHub...
git push origin arena/01a0735f-2026 2>&1
if !errorlevel! neq 0 (
    echo.
    echo       Push rejected - remote has newer commits. Pulling first...
    git pull origin arena/01a0735f-2026 --no-rebase --no-edit
    if !errorlevel! neq 0 (
        color 0C
        echo  [X] Merge conflict! Two versions touched the same lines.
        echo      Conflicted files are listed below - open them, keep the
        echo      correct version, then run this script again.
        echo.
        git diff --name-only --diff-filter=U
        pause
        exit /b 1
    )
    echo       Merged remote changes - pushing again...
    git push origin arena/01a0735f-2026
    if !errorlevel! neq 0 (
        color 0C
        echo  [X] Push failed again - screenshot this window and send it
        pause
        exit /b 1
    )
)
echo       Pushed OK.
echo.

:: ---- 5) done ----
color 0A
echo ================================================================
echo    [OK] All updates are now on GitHub!
echo    https://github.com/Abdulhame709/-2026
echo ================================================================
echo.
pause