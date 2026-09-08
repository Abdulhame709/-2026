@echo off
title Reconciliation - Push to GitHub
color 0B
setlocal EnableDelayedExpansion

cd /d "%~dp0"

echo ================================================================
echo    Push updates to GitHub
echo ================================================================
echo.

for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%b
echo    Current branch: !BRANCH!
echo.

echo [1/4] Changes:
git status -s
echo.

echo [2/4] Staging project files only...
git add backend frontend docs *.bat *.md
echo       OK
echo.

echo [3/4] Committing...
git commit -m "Local updates from my machine" >nul 2>&1
if !errorlevel! equ 0 (echo       Committed.) else (echo       Nothing new - already clean.)
echo.

echo [4/4] Pushing to GitHub...
git push origin !BRANCH! 2>&1
if !errorlevel! neq 0 (
    echo.
    echo       Remote is ahead - pulling and merging first...
    git pull origin !BRANCH! --no-rebase --no-edit
    if !errorlevel! neq 0 (
        color 0C
        echo  [X] Merge conflict - conflicted files:
        git diff --name-only --diff-filter=U
        echo      Open each file, keep the correct version, then run again.
        pause
        exit /b 1
    )
    git push origin !BRANCH!
    if !errorlevel! neq 0 (
        color 0C
        echo  [X] Push failed - screenshot this window
        pause
        exit /b 1
    )
)
echo       Pushed OK.

color 0A
echo.
echo ================================================================
echo    [OK] Updates are on GitHub - branch: !BRANCH!
echo    https://github.com/Abdulhame709/-2026
echo ================================================================
echo.
pause