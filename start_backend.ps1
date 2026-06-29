# 嘉法狮后端服务启动脚本 — 自动重启，永不停机
$node = "C:\Users\Shine Lu\.workbuddy\binaries\node\versions\22.22.2\node.exe"
$tsx = ".\node_modules\tsx\dist\cli.mjs"
$entry = ".\src\index.ts"
$args = @()  # 不使用 watch 模式，避免进程崩溃

cd "E:\项目开发区\嘉法狮网站重建\backend"

Write-Host "🔄 嘉法狮后台 API 服务启动中..."
while ($true) {
  & $node $tsx $entry
  Write-Host "`n⚠️ 服务已崩溃，5秒后自动重启..." -ForegroundColor Yellow
  Start-Sleep -Seconds 5
  Write-Host "🔄 正在重启..." -ForegroundColor Green
}
