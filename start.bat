@echo off
rem ============================================================
rem Local Media Player - Windows launcher (video + audio)
rem Double-click to start. Console window shows server logs;
rem press Ctrl+C or close the window to stop.
rem ============================================================
cd /d "%~dp0"

rem ===== Config (leave empty to use config.json / defaults) =====
set "VIDEO_DIR="
set "PORT=8080"
set "PASSWORD="
rem ==============================================================

rem Find Python: prefer "python", fall back to "py" launcher
set "PY=python"
where python >nul 2>nul
if errorlevel 1 (
    where py >nul 2>nul
    if errorlevel 1 (
        echo [ERROR] Python not found. Install it from https://www.python.org/
        pause
        exit /b 1
    )
    set "PY=py"
)

set "ARGS="
if defined VIDEO_DIR set ARGS=%ARGS% --dir "%VIDEO_DIR%"
if defined PORT set ARGS=%ARGS% --port %PORT%
if defined PASSWORD set ARGS=%ARGS% --password "%PASSWORD%"

echo Starting local media player (video + audio) on port %PORT% ...
echo The server banner below shows the access URLs (LAN IP).
echo (Press Ctrl+C or close this window to stop)
echo.
%PY% server.py %ARGS%
echo.
echo Server stopped.
pause
