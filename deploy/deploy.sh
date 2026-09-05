#!/bin/bash
# ===== 一键部署 / 更新脚本 =====
# 用法：把项目上传到 /www/wwwroot/gattefosse 后，执行：
#   cd /www/wwwroot/gattefosse && bash deploy/deploy.sh
# 首次部署和更新代码都跑这一条命令

set -e
APP_DIR=/www/wwwroot/gattefosse

echo "▶ 1/5 进入项目目录"
cd $APP_DIR

echo "▶ 2/5 安装后端依赖（首次较慢，约 1-3 分钟）"
cd backend
if [ ! -d "node_modules" ]; then
  npm install --registry=https://registry.npmmirror.com
else
  echo "   已存在 node_modules，跳过安装（如需重装请手动删除该目录）"
fi

echo "▶ 3/5 生成 Prisma 客户端"
npx prisma generate

echo "▶ 4/5 编译 TypeScript"
npx tsc

echo "▶ 5/5 用 PM2 启动 / 重启服务"
mkdir -p $APP_DIR/logs
if pm2 describe gattefosse > /dev/null 2>&1; then
  pm2 restart gattefosse --update-env
  echo "   ✓ 服务已重启"
else
  pm2 start $APP_DIR/deploy/ecosystem.config.js
  pm2 save
  pm2 startup
  echo "   ✓ 服务已启动，并设置为开机自启"
fi

echo ""
echo "=========================================="
echo " 部署完成！查看运行状态：pm2 status"
echo " 查看日志：pm2 logs gattefosse"
echo " 测试本机访问：curl http://127.0.0.1:3000/api/health"
echo "=========================================="
