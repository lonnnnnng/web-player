@echo off
rem ============================================================
rem Local Video Player - stopper
rem Kills the process listening on PORT (must match start.bat
rem or config.json). Run this to stop a server started by
rem start.bat or by "python server.py".
rem ============================================================
set "PORT=8080"

set FOUND=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /c:":%PORT% " ^| findstr LISTENING') do (
    set FOUND=1
    echo Stopping process PID %%a ...
    taskkill /f /pid %%a >nul 2>nul
)

if "%FOUND%"=="0" (
    echo No player is listening on port %PORT%.
) else (
    echo Stopped.
)
pause
