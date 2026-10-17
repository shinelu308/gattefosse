# Gattefosse site launcher with auto-restart.
# Serves frontend "/" + admin "/admin" + API "/api", all on port 3000.
# The old version hard-coded E:\... and a stale node path
# (C:\Users\Shine Lu\...\22.22.2), both invalid after the machine migration.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$node = 'node.exe'
$managed = Join-Path $env:USERPROFILE '.workbuddy\binaries\node\versions\22.22.2-6\node.exe'
if (-not (Get-Command $node -ErrorAction SilentlyContinue)) {
    if (Test-Path $managed) { $node = $managed }
    else {
        Write-Host '[ERROR] Node.js not found.' -ForegroundColor Red
        exit 1
    }
}

$starter = Join-Path $root 'scripts\start-site.js'
Write-Host 'Gattefosse site: frontend / + admin /admin + API /api on :3000' -ForegroundColor Green

while ($true) {
    & $node $starter
    Write-Host '' 
    Write-Host 'Service exited, restarting in 5s...' -ForegroundColor Yellow
    Start-Sleep -Seconds 5
    Write-Host 'Restarting...' -ForegroundColor Green
}
