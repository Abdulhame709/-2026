@echo off
chcp 65001 >nul
title مشغّل نظام مطابقة كشوف الموردين
mode con: cols=100 lines=35
color 0B

setlocal EnableDelayedExpansion

echo ================================================================
echo    نظام مطابقة كشوف حساب الموردين - المشغل التلقائي
echo    (اترك هذه النافذة مفتوحة اثناء العمل على النظام)
echo ================================================================
echo.

cd /d "%~dp0"

:: ============ 1) فحص النت والمكتبات ============
echo [1/5] فحص المكتبات المثبتة...
if not exist "backend\node_modules" (
    echo       مكتبات الخادم غير مثبتة - جاري التثبيت (يستغرق دقائق)...
    cd backend
    call npm install
    if !errorlevel! neq 0 (
        color 0C
        echo.
        echo  *** فشل تثبيت مكتبات الخادم - تحقق من اتصالك بالانترنت ثم أعد المحاولة ***
        pause
        exit /b 1
    )
    cd ..
)
if not exist "frontend\node_modules" (
    echo       مكتبات الواجهة غير مثبتة - جاري التثبيت (يستغرق دقائق)...
    cd frontend
    call npm install
    if !errorlevel! neq 0 (
        color 0C
        echo.
        echo  *** فشل تثبيت مكتبات الواجهة - تحقق من اتصالك بالانترنت ثم أعد المحاولة ***
        pause
        exit /b 1
    )
    cd ..
)
echo       OK
echo.

:: ============ 2) فحص قاعدة البيانات ============
echo [2/5] فحص قاعدة البيانات PostgreSQL...
pg_isready -h 127.0.0.1 -p 5432 >nul 2>&1
if !errorlevel! neq 0 (
    echo       خدمة PostgreSQL غير مشغلة - جاري تشغيلها...
    net start postgresql-x64-16 2>nul || net start postgresql-x64-17 2>nul || net start postgresql-x64-18 2>nul
    timeout /t 3 /nobreak >nul
)
pg_isready -h 127.0.0.1 -p 5432 >nul 2>&1
if !errorlevel! neq 0 (
    color 0C
    echo.
    echo  *** تعذر تشغيل خدمة قاعدة البيانات ***
    echo  تأكد أن PostgreSQL مثبت وأن خدمته تعمل من Services
    pause
    exit /b 1
)
echo       OK
echo.

:: ============ 3) فحص القاعدة نفسها ============
echo [3/5] فحص وجود قاعدة البيانات "reconciliation"...
psql -U postgres -d reconciliation -c "SELECT 1;" >nul 2>&1
if !errorlevel! neq 0 (
    if /I not "!NODE_ENV!"=="development" (
        echo  *** اضبط NODE_ENV=development قبل تهيئة قاعدة التطوير ***
        pause
        exit /b 1
    )
    if not defined SEED_ADMIN_PASSWORD (
        echo  *** عين SEED_ADMIN_PASSWORD وSEED_RECONCILER_PASSWORD وSEED_VIEWER_PASSWORD قبل التشغيل ***
        pause
        exit /b 1
    )
    if not defined SEED_RECONCILER_PASSWORD exit /b 1
    if not defined SEED_VIEWER_PASSWORD exit /b 1
    echo       القاعدة غير موجودة - جاري إنشاءها وتجهيزها...
    psql -U postgres -c "CREATE DATABASE reconciliation;" >nul 2>&1
    if !errorlevel! neq 0 (
        color 0C
        echo  *** تعذر إنشاء القاعدة - تأكد من كلمة مرور postgres ***
        pause
        exit /b 1
    )
    cd backend
    call npm run db:migrate
    if !errorlevel! neq 0 exit /b 1
    call npm run db:seed
    if !errorlevel! neq 0 exit /b 1
    cd ..
)
echo       OK
echo.

:: ============ 4) تشغيل الخادم والواجهة ============
echo [4/5] تشغيل الخادم (backend) في نافذة مستقلة...
if exist "%LOCALAPPDATA%\Mushabaka\backup-key.dpapi" (
    start "خادم النظام - لا تغلق هذه النافذة" cmd /k "cd /d %~dp0backend && powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\start-with-backup-key.ps1"
) else (
    echo       مفتاح النسخ غير معد - الموقع يعمل لكن إنشاء النسخ المشفرة غير متاح
    start "خادم النظام - لا تغلق هذه النافذة" cmd /k "cd /d %~dp0backend && npm run dev"
)

echo       انتظار جاهزية الخادم...
timeout /t 8 /nobreak >nul

echo [5/5] تشغيل الواجهة (frontend) في نافذة مستقلة...
start "واجهة النظام - لا تغلق هذه النافذة" cmd /k "cd /d %~dp0frontend && npm run dev"

:: ============ 5) فتح المتصفح ============
echo       انتظار جاهزية الواجهة ثم فتح المتصفح...
timeout /t 7 /nobreak >nul
start http://127.0.0.1:5173

:: ============ النهاية ============
color 0A
echo.
echo ================================================================
echo    ✔ تم تشغيل النظام بنجاح!
echo.
echo    المتصفح فتح على العنوان: http://127.0.0.1:5173
echo    تسجيل الدخول: حساب المدير النشط بكلمة مروره الخاصة
echo.
echo    ملاحظات مهمة:
echo    - لا تغلق نافذتي "خادم النظام" و "واجهة النظام"
echo    - لإيقاف النظام: أغلق النافذتين أو اضغط Ctrl+C داخل كل منهما
echo    - هذه النافذة يمكن إغلاقها الآن بأمان
echo ================================================================
echo.
pause
