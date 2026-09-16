@echo off
setlocal
cd /d "%~dp0"

if "%~1"=="" goto :usage

if /I "%~1"=="init" goto :init
if /I "%~1"=="start" goto :start
if /I "%~1"=="restart" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-all.ps1"
if /I "%~1"=="restart" if errorlevel 1 exit /b %ERRORLEVEL%
if /I "%~1"=="restart" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-all.ps1"
if /I "%~1"=="restart" exit /b %ERRORLEVEL%
if /I "%~1"=="status" goto :status
if /I "%~1"=="stop" goto :stop
if /I "%~1"=="validate" goto :validate
if /I "%~1"=="auth" goto :auth
if /I "%~1"=="help" goto :usage
if /I "%~1"=="--help" goto :usage
if /I "%~1"=="-h" goto :usage

echo Unknown command: %~1
goto :usage_error

:init
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\init-user.ps1"
exit /b %ERRORLEVEL%

:start
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-all.ps1"
exit /b %ERRORLEVEL%

:status
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\status-all.ps1"
exit /b %ERRORLEVEL%

:stop
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-all.ps1"
exit /b %ERRORLEVEL%

:validate
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0modules\transport\scripts\validate-windows.ps1"
exit /b %ERRORLEVEL%

:auth
if /I "%~2"=="generate" (
  node "%~dp0modules\transport\src\auth-cli.mjs" generate
  exit /b %ERRORLEVEL%
)
echo Usage: SPARK auth generate
exit /b 2

:usage
echo SPARK 0.0.1 - Symbiotic Personal AI Robotic Keeper
echo.
echo Usage: SPARK [init ^| start ^| restart ^| status ^| stop ^| validate ^| auth generate ^| help]
echo.
echo   init       Create a new private config and 256-bit per-instance SPARK access key
echo   start      Start Transport + Secure MCP Tunnel + ChatGPT UI
echo   restart    Stop and start all runtime components
echo   status     Show Transport, Tunnel, ChatGPT and ChatGPT UI status
echo   stop       Stop runtime components
echo   validate   Run Windows Transport validation
echo   auth generate  Generate a new 256-bit SPARK access key without changing config
echo   help       Show this help
echo.
echo No argument shows this help. New installations should run "SPARK init" first.
exit /b 0

:usage_error
echo Usage: SPARK [init ^| start ^| restart ^| status ^| stop ^| validate ^| auth generate ^| help]
exit /b 2
