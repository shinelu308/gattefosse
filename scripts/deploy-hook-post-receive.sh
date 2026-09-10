#!/bin/sh
export PATH=/usr/local/node/bin:/usr/local/bin:/usr/bin:/bin:$PATH
GIT_WORK_TREE=/opt/gattefosse git --git-dir=/opt/git/gattefosse.git checkout -f master
cd /opt/gattefosse/backend
LOCK_NOW=$(md5sum package-lock.json | cut -d ' ' -f1)
LOCK_OLD=$(cat /opt/gattefosse/.lock_hash 2>/dev/null)
echo "=== deploy start $(date) ===" >> /var/log/gattefosse-deploy.log
if [ "$LOCK_NOW" != "$LOCK_OLD" ]; then
  npm install --registry=https://registry.npmmirror.com --no-audit --no-fund >> /var/log/gattefosse-deploy.log 2>&1
  echo "$LOCK_NOW" > /opt/gattefosse/.lock_hash
  echo "deps updated" >> /var/log/gattefosse-deploy.log
fi
# schema 或依赖变化都重新生成 client（generate 很快，代价可忽略）
SCHEMA_NOW=$(md5sum prisma/schema.prisma | cut -d ' ' -f1)
SCHEMA_OLD=$(cat /opt/gattefosse/.schema_hash 2>/dev/null)
if [ "$LOCK_NOW" != "$LOCK_OLD" ] || [ "$SCHEMA_NOW" != "$SCHEMA_OLD" ]; then
  npx prisma generate >> /var/log/gattefosse-deploy.log 2>&1
  echo "$SCHEMA_NOW" > /opt/gattefosse/.schema_hash
  echo "prisma client regenerated" >> /var/log/gattefosse-deploy.log
fi
npx tsc >> /var/log/gattefosse-deploy.log 2>&1
if [ $? -ne 0 ]; then
  echo "!!! tsc FAILED - dist may be stale" >> /var/log/gattefosse-deploy.log
fi
systemctl restart gattefosse
echo "=== deploy done $(date) ===" >> /var/log/gattefosse-deploy.log
