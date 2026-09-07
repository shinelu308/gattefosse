#!/bin/sh
# 嘉法狮网站一键部署
# 用法：本地先在 main 分支提交所有改动，然后在项目根目录执行  sh scripts/deploy.sh
# 流程：把 main 的内容快照为 release 分支新提交 -> 推送到服务器裸仓库
#       服务器 post-receive 钩子自动：检出 -> 依赖变更时 npm install+prisma generate -> tsc -> 重启服务
set -e
cd "$(dirname "$0")/.."

BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "当前分支: $BRANCH（部署内容固定取自 main）"

if [ -n "$(git status --porcelain)" ]; then
  echo "⚠️  工作区有未提交改动，将只部署已提交到 main 的内容。"
fi

# 确保在 main 上提交了最新代码
git fetch deploy 2>/dev/null || true

# 用 main 的树创建 release 新提交（快照式同步，不含历史）
TREE=$(git rev-parse main^{tree})
MSG="deploy: $(git log -1 --format=%s main)"
NEW=$(git commit-tree "$TREE" -p refs/heads/release -m "$MSG")
git update-ref refs/heads/release "$NEW"
git log --oneline release -1

echo "推送到服务器（触发自动构建+重启）..."
git push deploy release:master
echo ""
echo "✅ 部署完成，验证地址：https://gattefosse.loudaren.com"
echo "   服务器部署日志：/var/log/gattefosse-deploy.log"
