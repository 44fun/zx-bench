@echo off
chcp 65001 >nul 2>&1
title 智秀大模型评测 - Stop Server
setlocal enabledelayedexpansion

set "PORT=3001"
set "LOGDIR=%~dp0logs"
set "PIDFILE=%LOGDIR%\server.pid"
set "NODEPIDFILE=%LOGDIR%\node.pid"

echo [INFO] Stopping 智秀大模型评测 Server (graceful mode)...
echo.

:: ============================================================
::  温和停止策略（避免强杀导致系统不稳定）：
::  1. 读取 watchdog PID (server.pid) 和 node PID (node.pid)
::  2. 对两者发普通终止信号（无 /F，进程可自行清理退出）
::  3. 轮询等待最多 15 秒
::  4. 仍存活才兜底强杀；最后用 netstat 验证端口释放
::  全程不使用 WMI、不使用 tasklist /v、不使用 PowerShell
:: ============================================================

set "WATCHDOG_PID="
set "SERVER_PID="

:: --- 1. 读取 PID 文件 ---
if exist "%PIDFILE%" (
    set /p WATCHDOG_PID=<"%PIDFILE%"
)
if exist "%NODEPIDFILE%" (
    set /p SERVER_PID=<"%NODEPIDFILE%"
)

if not defined SERVER_PID (
    echo [INFO] node.pid not found. Trying port detection...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
        set "SERVER_PID=%%a"
    )
)

if not defined SERVER_PID if not defined WATCHDOG_PID (
    echo [INFO] No server process found. Nothing to stop.
    goto :cleanup
)

:: --- 2. 对 watchdog 和 node 进程发普通终止信号（无 /F） ---
if defined WATCHDOG_PID (
    echo [INFO] Stopping watchdog PID !WATCHDOG_PID! ...
    taskkill /PID !WATCHDOG_PID! >nul 2>&1
)
if defined SERVER_PID (
    echo [INFO] Stopping server PID !SERVER_PID! ...
    taskkill /PID !SERVER_PID! >nul 2>&1
)

:: --- 3. 轮询等待 node 进程自行退出（最多 15 秒） ---
if defined SERVER_PID (
    set "EXITED=0"
    for /L %%i in (1,1,15) do (
        if !EXITED! equ 0 (
            tasklist /FI "PID eq !SERVER_PID!" 2>nul | find "!SERVER_PID!" >nul
            if !errorlevel! neq 0 (
                set "EXITED=1"
                echo [OK] Server exited gracefully after %%i seconds.
            ) else (
                timeout /t 1 /nobreak >nul
            )
        )
    )

    :: --- 4. 兜底：仅在进程未退出时才强杀 ---
    if !EXITED! equ 0 (
        echo [WARN] Process did not exit within 15s, forcing...
        taskkill /PID !SERVER_PID! /F >nul 2>&1
        timeout /t 1 /nobreak >nul
    )
)

:cleanup
:: --- 5. 清理 PID 文件 ---
if exist "%PIDFILE%" (
    del /q "%PIDFILE%" >nul 2>&1
)
if exist "%NODEPIDFILE%" (
    del /q "%NODEPIDFILE%" >nul 2>&1
)
echo [INFO] Cleaned up PID files.

:: --- 6. 验证端口释放 ---
timeout /t 1 /nobreak >nul
netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul 2>&1
if !errorlevel! equ 0 (
    echo [WARN] Port %PORT% still in use. Check manually: netstat -ano ^| findstr :%PORT%
) else (
    echo [OK] Port %PORT% is free. Server stopped.
)

echo.
:: 手动双击时暂停显示结果；被 start.bat 调用（带参数）时不暂停
if "%~1"=="" pause
