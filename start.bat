@echo off
chcp 65001 >nul 2>&1
title 智秀大模型评测 - WebUI Server
setlocal enabledelayedexpansion

:: ============================================================
::  智秀大模型评测 - Windows Launcher
::  Location: %~dp0start.bat
::  Usage: Double-click or run in terminal
:: ============================================================

:: --- Config ---
set "PROJECT_DIR=%~dp0"
set "SERVER_DIR=%PROJECT_DIR%\apps\server"
set "WEB_DIR=%PROJECT_DIR%\apps\web"
set "PORT=3001"
set "MANAGED_NODE=node"
set "SYSTEM_NODE=node"

:: --- Pick node binary ---
set "NODE_BIN="
if exist "%MANAGED_NODE%" (
    set "NODE_BIN=%MANAGED_NODE%"
) else (
    where %SYSTEM_NODE% >nul 2>&1
    if !errorlevel! equ 0 (
        set "NODE_BIN=%SYSTEM_NODE%"
    ) else (
        echo [ERROR] Node.js not found. Install Node.js 18+ or fix path.
        pause
        exit /b 1
    )
)

:: --- Check build artifacts ---
if not exist "%SERVER_DIR%\dist\index.js" (
    echo [WARN] Server not built. Building now...
    cd /d "%SERVER_DIR%"
    call npx --package=typescript tsc
    if !errorlevel! neq 0 (
        echo [ERROR] Server build failed.
        pause
        exit /b 1
    )
)

if not exist "%WEB_DIR%\dist\index.html" (
    echo [WARN] Web not built. Building now...
    cd /d "%WEB_DIR%"
    call npx vite build
    if !errorlevel! neq 0 (
        echo [ERROR] Web build failed.
        pause
        exit /b 1
    )
)

:: --- Check if port already in use (with health check, 使用 curl 避免 PowerShell/WMI) ---
set "ALREADY_RUNNING=0"
netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul 2>&1
if !errorlevel! equ 0 (
    echo [INFO] Port %PORT% in use - checking health...
    curl -s -o nul --max-time 3 "http://127.0.0.1:%PORT%/api/health" >nul 2>&1
    if !errorlevel! equ 0 (
        echo [OK] Health check passed - server is running.
        set "ALREADY_RUNNING=1"
    ) else (
        echo [WARN] Port %PORT% in use but health check failed - cleaning stale processes...
        call "%PROJECT_DIR%\stop.bat" auto
        echo [INFO] Stale processes cleaned. Will restart.
        timeout /t 2 /nobreak >nul
    )
)

:: --- Start server (reliable watchdog mode) ---
if "!ALREADY_RUNNING!"=="0" (
    echo [INFO] Starting 智秀大模型评测 server with watchdog on port %PORT% ...
    cd /d "%PROJECT_DIR%"
    powershell -ExecutionPolicy Bypass -File "start-server.ps1" -Port %PORT%
) else (
    echo [OK] Server already running.
)

:open_browser
:: --- Open browser ---
echo [INFO] Opening browser at http://localhost:%PORT% ...
start "" "http://localhost:%PORT%"

echo.
echo ============================================================
echo  智秀大模型评测 is running at http://localhost:%PORT%
echo  Press Ctrl+C in the server window to stop.
echo  This window can be closed safely.
echo ============================================================
echo.
timeout /t 3 /nobreak >nul
