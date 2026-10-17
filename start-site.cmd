@echo off
setlocal
cd /d "%~dp0"

rem ---- locate node.exe (PATH first, then managed runtime) ----
set "NODEEXE="
for %%I in (node.exe) do if not defined NODEEXE set "NODEEXE=%%~$PATH:I"
if not defined NODEEXE set "NODEEXE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"

if not exist "%NODEEXE%" (
  echo.
  echo   [ERROR] Node.js not found.
  echo   Tried PATH and: %USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe
  echo.
  pause
  exit /b 1
)

echo   Using node: %NODEEXE%
echo.

"%NODEEXE%" "%~dp0scripts\start-site.js" %*

echo.
pause
endlocal
