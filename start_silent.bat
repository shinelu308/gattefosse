@echo off
chcp 65001 >nul
rem ============================================================
rem  嘉法狮站点 — 静默启动（无窗口）
rem  统一入口：前台 / + 后台 /admin + API 全在 3000 端口
rem  原脚本写死 e:\项目开发区\嘉法狮网站重建，换机后已失效
rem ============================================================
setlocal
cd /d "%~dp0"

set "NODEEXE="
for %%I in (node.exe) do if not defined NODEEXE set "NODEEXE=%%~$PATH:I"
if not defined NODEEXE set "NODEEXE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"

if not exist "%NODEEXE%" (
  echo [ERROR] Node.js not found.
  pause
  exit /b 1
)

start /MIN "" "%NODEEXE%" "%~dp0scripts\start-site.js"
exit /b 0
