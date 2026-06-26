@echo off
cd /d "e:\项目开发区\嘉法狮网站重建\site"
python -m http.server 3000 >nul 2>&1
